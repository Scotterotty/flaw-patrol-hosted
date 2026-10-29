"use server";

import { parsePlatforms } from "@/lib/umbrella";
import { parseSentryRefs, sentryAdf } from "@/lib/sentry";
import { sentryFrames } from "./sentry";
import { logActivity } from "@/lib/activity";
import { pickValues } from "@/lib/run-fields";
import { runFieldsFor } from "@/lib/run-fields-server";
import { Prisma, type Severity } from "@prisma/client";
import { missionLine, parseCharter } from "@/lib/charter";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { seal } from "@/lib/crypto";
import { caseKey } from "@/lib/format";
import {
  adfHeadings,
  clientIn,
  exampleValue,
  featureOf,
  FIELD,
  FIELD_SOURCES,
  guessField,
  guessSection,
  importedTitle,
  SECTION_SOURCES,
  templateKind,
  titlePattern,
  type ImportedTemplate,
  friendlyNames,
  optionLike,
  orderFiles,
  parseProfile,
  parseTemplateSettings,
  tagOf,
  templateTitle,
  tenantOf,
  type TemplateBug,
  type TemplateSettings,
} from "@/lib/bug-template";
import { JiraClient, JiraError, jiraFor, jiraValue, normalizeSite, refreshDefectStatuses, type FieldValue, type JiraIssue, type JiraUser, type MetaField } from "@/lib/jira";
import { bugAdf, defaultSummary, importedAdf, parseIssueKey, sectionText, templateAdf, type BugContext, type FileRef } from "@/lib/jira-format";
import { requireProjectAction, requireUser } from "@/lib/session";
import { DEFAULT_SEVERITY, PLAIN_SCALE, SEVERITIES, severitySchema, type SeverityConfig } from "@/lib/severity";
import type { ExpandedStep } from "@/lib/steps";
import { alertBugFiled } from "@/lib/slack";
import { attempt, UserError } from "./result";
import { jiraConfigFor } from "@/lib/umbrella";
import { entryRegression } from "@/lib/regression-data";

async function wrap<T extends object>(fn: () => Promise<T>) {
  return attempt(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof JiraError) throw new UserError(e.message);
      throw e;
    }
  });
}

const configSchema = z.object({
  siteUrl: z.string().trim().url("Enter the site address, like https://yourcompany.atlassian.net"),
  email: z.string().trim().email("Enter the email of the Jira account"),
  token: z.string().trim().max(500).default(""),
  jiraProjectKey: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]+$/, "Enter the Jira project key, like QA"),
  issueType: z.string().trim().min(1).max(100).default("Bug"),
});

export async function saveJiraConfig(projectId: string, input: z.input<typeof configSchema>) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const data = configSchema.parse(input);
    const existing = await db.jiraConfig.findUnique({ where: { projectId } });
    let token = data.token;
    if (!token) {
      if (!existing) throw new UserError("Paste an API token.");
      token = (await jiraFor(projectId))!.creds.token;
    }
    const client = new JiraClient({ ...data, siteUrl: normalizeSite(data.siteUrl), token });
    const who = await client.check();
    const row = { siteUrl: normalizeSite(data.siteUrl), email: data.email, tokenEncrypted: seal(token), jiraProjectKey: data.jiraProjectKey, issueType: data.issueType };
    // A new connection reads its severity names from a field called Severity, when the bug screen has one (ver_91).
    const severity = existing?.severity ? undefined : await detectSeverity(client);
    await db.jiraConfig.upsert({ where: { projectId }, create: { projectId, ...row, ...(severity && { severity }) }, update: { ...row, ...(severity && { severity }) } });
    revalidatePath(`/p/${project.key}`, "layout");
    revalidatePath("/g", "layout");
    await logActivity({ actor: user, kind: "settings", action: existing ? "Changed Jira connection" : "Connected Jira", project, detail: [`${normalizeSite(data.siteUrl).replace(/^https?:\/\//, "")} · ${data.jiraProjectKey}`, data.token && existing && "API token replaced"].filter(Boolean).join(" · ") });
    return { connectedAs: who };
  });
}

/** The bug screen's Severity field and its values, or null when there isn't one with a list. */
async function detectSeverity(client: JiraClient): Promise<SeverityConfig | null> {
  const meta = await client.createMeta(true).catch(() => null);
  const f = meta?.find((x) => x.name.trim().toLowerCase() === "severity" && x.options.length > 0);
  if (!f) return null;
  const values = f.options.slice(0, SEVERITIES.length);
  return { fieldId: f.id, fieldName: f.name, values, critical: values.slice(0, Math.min(2, values.length - 1)) };
}

/** Settings → Jira → Severity field (ver_91): the bug screen's fields that have a list of values. */
export async function jiraSeverityFields(projectId: string) {
  return wrap(async () => {
    await requireProjectAction(projectId, "jira:manage");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    const meta = await client.createMeta(true);
    const fields = meta.filter((f) => f.options.length > 1 && !["priority", "issuetype", "project"].includes(f.id)).map((f) => ({ id: f.id, name: f.name, values: f.options }));
    return { fields };
  });
}

const severitySaveSchema = z.object({ fieldId: z.string().max(100).nullable(), critical: z.array(z.string().max(200)).max(SEVERITIES.length).default([]) });

/** Save which Jira field holds severity and which of its values count as critical. Null goes back to the plain list. */
export async function saveSeverityField(projectId: string, input: z.input<typeof severitySaveSchema>) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const data = severitySaveSchema.parse(input);
    const cfg = await jiraConfigFor(projectId);
    if (!cfg) throw new UserError("Connect Jira first.");
    if (cfg.projectId !== projectId) throw new UserError("This test cycle uses its umbrella's Jira. Change the severity field in the umbrella's settings.");
    let severity: SeverityConfig | null = null;
    if (data.fieldId) {
      const client = (await jiraFor(projectId))!;
      const f = (await client.createMeta(true)).find((x) => x.id === data.fieldId);
      if (!f || !f.options.length) throw new UserError("That field isn't on the bug screen anymore, or has no values.");
      const values = f.options.slice(0, SEVERITIES.length);
      severity = { fieldId: f.id, fieldName: f.name, values, critical: data.critical.filter((c) => values.includes(c)) };
    }
    await db.jiraConfig.update({ where: { projectId: cfg.projectId }, data: { severity: severity ?? Prisma.DbNull } });
    revalidatePath(`/p/${project.key}`, "layout");
    revalidatePath("/g", "layout");
    await logActivity({ actor: user, kind: "settings", action: "Changed the Jira severity field", project, detail: severity ? severity.fieldName : "Plain list" });
    return { severity };
  });
}

export async function removeJiraConfig(projectId: string) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    await db.jiraConfig.deleteMany({ where: { projectId } });
    revalidatePath(`/p/${project.key}`, "layout");
    revalidatePath("/g", "layout");
    await logActivity({ actor: user, kind: "settings", action: "Removed Jira connection", project });
    return {};
  });
}

export type LinkedDefect = { id: string; number: number; title: string; externalKey: string | null; externalUrl: string | null; status: string };

function toLinked(d: { id: string; number: number; title: string; externalKey: string | null; externalUrl: string | null; externalStatus: string | null; status: string }): LinkedDefect {
  return { id: d.id, number: d.number, title: d.title, externalKey: d.externalKey, externalUrl: d.externalUrl, status: d.externalStatus ?? d.status };
}

type Person = { name: string | null; email: string; jiraEmail: string | null };

/** The email we look the person up by in Jira: their Jira email when they set one. */
const jiraEmailOf = (p: Person) => (p.jiraEmail?.trim() || p.email).toLowerCase();

/** The person's Jira account, or null when none matches (or Jira won't let us search people). */
async function jiraAccountOf(client: JiraClient, p: Person): Promise<JiraUser | null> {
  return client.findUser(jiraEmailOf(p)).catch(() => null);
}

export type ReporterInfo = { found: true; name: string; email: string } | { found: false; email: string; owner: string };

async function reporterInfo(client: JiraClient, p: Person): Promise<ReporterInfo> {
  const account = await jiraAccountOf(client, p);
  if (account) return { found: true, name: account.displayName, email: jiraEmailOf(p) };
  return { found: false, email: jiraEmailOf(p), owner: await client.owner().catch(() => client.creds.email) };
}

/** Mirror a Jira issue as a local defect (one row per issue key). */
// filed is false when someone links an issue that already existed in Jira: it counts as their bug for nothing.
async function upsertFromIssue(projectId: string, issue: JiraIssue, user: { id: string; name: string | null; email: string }, severity?: Severity, filed = true) {
  const existing = await db.defect.findFirst({ where: { projectId, externalKey: issue.key } });
  const fields = {
    title: issue.summary,
    externalUrl: issue.url,
    externalStatus: issue.status || null,
    externalCategory: issue.category || null,
    externalPriority: issue.priority || null,
    status: issue.category === "done" ? ("FIXED" as const) : ("OPEN" as const),
    // Jira's Severity field wins when the site has one.
    ...(issue.severity && { severity: issue.severity }),
    syncedAt: new Date(),
  };
  if (existing) return db.defect.update({ where: { id: existing.id }, data: fields });
  const { defectSeq } = await db.project.update({ where: { id: projectId }, data: { defectSeq: { increment: 1 } } });
  return db.defect.create({
    data: { projectId, number: defectSeq, externalKey: issue.key, severity: severity ?? DEFAULT_SEVERITY, createdById: user.id, createdBy: user.name ?? user.email, filed, ...fields },
  });
}

/** Search the connected Jira project, or fetch one issue when a key or link is typed. */
export async function searchJira(projectId: string, query: string) {
  return wrap(async () => {
    await requireProjectAction(projectId, "run:execute");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    const key = parseIssueKey(query);
    const issues = key ? [await client.getIssue(key)] : await client.searchBugs(query);
    return { issues };
  });
}

export async function linkJiraIssue(projectId: string, key: string) {
  return wrap(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    const parsed = parseIssueKey(key);
    if (!parsed) throw new UserError("Enter an issue key like QA-123.");
    const defect = await upsertFromIssue(projectId, await client.getIssue(parsed), user, undefined, false);
    return { defect: toLinked(defect) };
  });
}

const line = (max = 300) => z.string().max(max).default("");
const templateSchema = z.object({
  clientTag: line(40),
  feature: line(120),
  brief: z.string().trim().min(1, "Add a brief summary for the title").max(200),
  observedOn: line(),
  clientsNeeded: line(),
  what: line(10000),
  slack: line(1000),
  history: z.object({ dateTime: line(60), client: line(), csp: line(), context: line(500), user: line(), envTenant: line(), repros: line(40) }),
  reproSteps: line(20000),
  spaceLink: line(1000),
  impact: line(5000),
  workaround: line(5000),
  reproRate: line(40),
  build: line(),
  clients: z.array(z.string().max(100)).max(30).default([]),
  team: line(100),
  olyEnv: z.array(z.string().max(100)).max(30).default([]),
});

const bugSchema = z.object({
  summary: z.string().trim().max(250).default(""),
  severity: severitySchema.default(DEFAULT_SEVERITY),
  stepIndex: z.number().int().min(0).nullable(),
  actual: z.string().max(10000).default(""),
  attachmentIds: z.array(z.string()).max(20).default([]),
  /** Stories of the case to link the new bug to, with Jira's "relates to". */
  stories: z.array(z.string().max(30)).max(10).default([]),
  /** Regression flag (ver_93): add the Jira label and the passed-in / fails-in builds line. */
  regression: z.boolean().default(false),
  /** Send to Jira (ver_91): the bug saved here before Jira was connected, which becomes the new issue. */
  fromDefectId: z.string().optional(),
  /** Sentry errors (ver_96): a section at the end of the description. */
  sentry: z.array(z.unknown()).max(20).default([]),
  template: templateSchema.optional(),
  imported: z
    .object({
      tag: line(40),
      feature: line(120),
      summary: z.string().trim().min(1, "Add a summary for the title").max(200),
      sections: z.array(z.object({ heading: z.string().max(120), text: z.string().max(20000) })).max(40),
      fields: z.record(z.string().max(60), z.array(z.string().max(5000)).max(30)),
    })
    .optional(),
});

/** Build the context for a bug report from a run entry. */
async function bugContext(projectId: string, entryId: string, stepIndex: number | null, actual: string) {
  const entry = await db.runEntry.findFirst({
    where: { id: entryId, run: { projectId } },
    include: { run: { include: { project: true } }, testCase: { select: { number: true, tags: true, project: { select: { key: true, groupId: true, hubOf: { select: { platforms: true } } } } } } },
  });
  if (!entry) throw new UserError("This case is no longer in the run.");
  // Bracket tags (ver_96): platform tags and ALL-CAPS ones like ANDROID go back in front of the bug's title.
  const platformNames = parsePlatforms(entry.testCase.project.hubOf?.platforms).map((p) => p.name.toLowerCase());
  const titleTags = entry.testCase.tags.filter((t) => platformNames.includes(t.toLowerCase()) || (/[A-Z]/.test(t) && t === t.toUpperCase()));
  const steps = (Array.isArray(entry.steps) ? entry.steps : []) as unknown as ExpandedStep[];
  if (stepIndex !== null && !steps[stepIndex]) throw new UserError("That step no longer exists.");
  const h = await headers();
  const origin = h.get("origin") ?? (h.get("host") ? `https://${h.get("host")}` : null);
  const key = entry.run.project.key;
  const ctx: BugContext = {
    caseKey: caseKey(entry.testCase.project.key, entry.testCase.number),
    caseTitle: entry.title,
    runLabel: `run R${entry.run.number} "${entry.run.name}"`,
    build: entry.run.build,
    release: entry.run.release,
    cspVersion: entry.run.cspVersion,
    fields: pickValues(entry.run, await runFieldsFor(projectId), "jira"),
    environment: entry.run.environment,
    // A session's bug carries the charter, since there are no steps to point at.
    preconditions:
      entry.kind === "EXPLORATORY" ? [`Charter: ${missionLine(parseCharter(entry.charter))}`, entry.preconditions].filter(Boolean).join("\n") : entry.preconditions,
    steps: steps.map((s) => ({ number: s.number, action: s.action, expected: s.expected })),
    failedIndex: stepIndex,
    actual,
    link: origin ? `${origin}/p/${key}/runs/${entry.run.number}/execute?entry=${entry.id}` : null,
    titleTags,
  };
  return { ctx, entry };
}

type Entry = Awaited<ReturnType<typeof bugContext>>["entry"];

const findField = (meta: MetaField[] | null, name: string) => meta?.find((f) => f.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
/** An imported field on this Jira: by its id when the name still matches, else by name (a company template read from another Jira, ver_96). */
const metaFor = (meta: MetaField[] | null, f: { id: string; name: string }) => meta?.find((x) => x.id === f.id && x.name.trim().toLowerCase() === f.name.trim().toLowerCase()) ?? findField(meta, f.name) ?? undefined;

/** The project's template settings, or null when the plain layout is used. */
async function templateOf(projectId: string): Promise<TemplateSettings | null> {
  const row = await jiraConfigFor(projectId);
  const t = parseTemplateSettings(row?.bugTemplate);
  return templateKind(t) === "detailed" ? t : null;
}

/** The project's imported template, or null when it uses another layout. */
async function importedOf(projectId: string): Promise<ImportedTemplate | null> {
  const t = parseTemplateSettings((await jiraConfigFor(projectId))?.bugTemplate);
  return templateKind(t) === "imported" ? t.imported : null;
}

/** What the dialog shows for an imported template: the title parts, each section's text and each field's value, filled from the run. */
export type ImportedDraft = {
  title: { tag: boolean; feature: boolean };
  tag: string;
  feature: string;
  sections: { heading: string; source: string; text: string }[];
  /** pick: Jira only takes one of its own choices here (a version, component or option). */
  fields: { id: string; name: string; required: boolean; source: string; value: string[]; options: string[]; multi: boolean; long: boolean; pick: boolean }[];
};

/** Fields where Jira only takes one of its own choices: versions, components and options. */
const isPick = (m: MetaField | undefined) => !!m && [m.schema.type, m.schema.items].some((t) => t === "version" || t === "component" || t === "option");

function importedDraft(t: ImportedTemplate, entry: Entry, ctx: BugContext, meta: MetaField[] | null): ImportedDraft {
  const run = entry.run;
  return {
    title: t.title,
    tag: tagOf(entry.title) || clientIn(`${run.name} ${run.project.name}`).toUpperCase(),
    feature: featureOf(entry.title),
    sections: t.sections.filter((x) => x.source !== "empty").map((x) => ({ heading: x.heading, source: x.source, text: sectionText(x.source, ctx) })),
    fields: t.fields
      .filter((f) => f.source !== "empty")
      .map((f) => {
        const m = metaFor(meta, f);
        const value = f.source === "default" ? f.value : f.source === "release" ? [run.release || run.build].filter(Boolean) : [];
        return { id: f.id, name: f.name, required: f.required, source: f.source, value, options: m?.options ?? [], multi: m?.schema.type === "array", long: !!m?.schema.custom?.endsWith(":textarea"), pick: isPick(m) };
      }),
  };
}

/** The template filled in from the run, the case, the project's defaults and what this tester typed last time. */
function templateDefaults(t: TemplateSettings, entry: Entry, ctx: BugContext, meta: MetaField[] | null, profileRaw: unknown) {
  const run = entry.run;
  const word = clientIn(`${run.name} ${run.project.name}`) || clientIn(entry.title);
  const clientTag = t.clientTag || tagOf(entry.title) || word.toUpperCase();
  const clientName = word || clientTag;
  const options = {
    clients: findField(meta, FIELD.clients)?.options ?? [],
    team: findField(meta, FIELD.team)?.options ?? [],
    olyEnv: findField(meta, FIELD.olyEnv)?.options ?? [],
  };
  const envOption = optionLike(options.olyEnv, run.environment);
  const remembered = parseProfile(profileRaw)[clientTag] ?? {};
  const bug: TemplateBug = {
    clientTag,
    feature: featureOf(entry.title),
    brief: "",
    observedOn: [clientName && `${clientName} client`, run.environment, run.release].filter(Boolean).join(", "),
    clientsNeeded: word || (clientTag && clientTag.charAt(0) + clientTag.slice(1).toLowerCase()),
    what: ctx.actual,
    slack: "",
    history: {
      dateTime: "",
      client: [clientName, run.build].filter(Boolean).join("\n"),
      csp: run.cspVersion,
      context: remembered.context ?? "",
      user: remembered.user ?? "",
      envTenant: [run.environment, remembered.tenant].filter(Boolean).join("\n"),
      repros: "1/1",
    },
    // The tester writes the steps; Jira requires the field, so the dialog asks for it.
    reproSteps: "",
    spaceLink: "",
    impact: "",
    workaround: "",
    reproRate: "1/1",
    build: `Version ${run.build || "x"} - CSP ${run.cspVersion || "x"}`,
    clients: t.clients.length ? t.clients : [optionLike(options.clients, word)].filter(Boolean),
    team: t.team || optionLike(options.team, word),
    olyEnv: envOption ? [envOption] : t.olyEnv,
  };
  return { bug, options, web: /^web/i.test(clientName), trace: { label: `${ctx.caseKey} in ${ctx.runLabel}`, link: ctx.link } };
}

/** The template's Jira fields by name, with the values typed for them. */
function templateValues(b: TemplateBug): [string, FieldValue][] {
  const date = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(b.history.dateTime);
  return [
    [FIELD.clients, b.clients],
    [FIELD.team, b.team],
    [FIELD.reproRate, b.reproRate],
    [FIELD.build, b.build],
    [FIELD.olyEnv, b.olyEnv],
    [FIELD.reproSteps, b.reproSteps],
    [FIELD.spaceLink, b.spaceLink.trim() || "N/a"],
    [FIELD.impact, b.impact],
    [FIELD.workaround, b.workaround],
    [FIELD.lastReproduced, date ? `${date[1]}-${date[2]}-${date[3]}` : new Date().toISOString().slice(0, 10)],
  ];
}

const asText = (v: FieldValue) => (Array.isArray(v) ? v.join(", ") : v);

/**
 * File a bug in the team template: fields Jira has go in their own fields, the
 * rest into the description. Attachments go up after the bug exists, then the
 * description is written again to show them: screenshots and videos inline when
 * Jira gives their media ids, otherwise as links.
 */
async function fileTemplateBug(client: JiraClient, b: TemplateBug, severity: Severity, account: JiraUser | null, tester: string, files: { fileName: string; contentType: string; data: Uint8Array }[], trace: { label: string; link: string | null }) {
  const meta = await client.createMeta().catch(() => null);
  const fields: Record<string, { name: string; value: unknown }> = {};
  const extra: { name: string; text: string }[] = [];
  for (const [name, value] of templateValues(b)) {
    const f = findField(meta, name);
    const list = (Array.isArray(value) ? value : [value]).filter((x) => x.trim());
    // An option Jira doesn't list would get the whole bug refused.
    const known = !f?.options.length || list.every((x) => f.options.includes(x));
    const jira = f && known ? jiraValue(f, value) : undefined;
    if (f && jira !== undefined) fields[f.id] = { name, value: jira };
    else if (name !== FIELD.lastReproduced && asText(value).trim()) extra.push({ name, text: asText(value) });
  }
  const valueOf = new Map(templateValues(b).map(([n, v]) => [n, asText(v)]));
  const sorted = friendlyNames([...orderFiles(files).media, ...orderFiles(files).logs], b);
  const describe = (reporterSet: boolean, dropped: string[], refs: FileRef[]) =>
    templateAdf(b, {
      reportedBy: account && reporterSet ? null : tester,
      files: refs,
      extra: [...extra, ...dropped.filter((n) => valueOf.has(n) && n !== FIELD.lastReproduced).map((n) => ({ name: n, text: valueOf.get(n)! }))],
      trace,
    });
  const names = sorted.map((f) => ({ fileName: f.fileName, contentType: f.contentType }));
  const { key, reporterSet, dropped } = await client.createIssue({
    summary: templateTitle(b),
    description: (left) => describe(left.reporterSet, left.dropped, names),
    severity,
    reporterId: account?.accountId,
    fields,
  });
  let attachError: string | null = null;
  let linkError: string | null = null;
  if (sorted.length) {
    try {
      const added = await client.attach(key, sorted);
      const refs: FileRef[] = sorted.map((f, i) => {
        const a = added[i];
        return { fileName: f.fileName, contentType: f.contentType, url: a ? client.attachmentUrl(a.id, a.filename) : undefined };
      });
      const withMedia = await Promise.all(
        refs.map(async (r, i) => (added[i] && /^(image|video)\//.test(r.contentType) ? { ...r, mediaId: (await client.mediaId(added[i].id)) ?? undefined } : r)),
      );
      // Inline first; if Jira won't take the media, links in the same places.
      await client
        .setDescription(key, describe(reporterSet, dropped, withMedia))
        .catch(() => client.setDescription(key, describe(reporterSet, dropped, refs)))
        .catch((e: unknown) => {
          linkError = `${key} was created and its files are in Jira's Attachments, but Jira wouldn't let Flaw Patrol show them in the description (${e instanceof Error ? e.message : "unknown error"}). The description lists them by name.`;
        });
    } catch (e) {
      attachError = e instanceof Error ? e.message : "Attachments failed to upload.";
    }
  }
  return { key, reporterSet, attachError, linkError };
}

export async function fileJiraBug(projectId: string, entryId: string, input: z.input<typeof bugSchema>) {
  return wrap(async () => {
    const { user, project } = await requireProjectAction(projectId, "run:execute");
    const data = bugSchema.parse(input);
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    if (data.regression) {
      // Worked out here again, so the label and builds line only go on when the case really is flagged.
      const reg = await entryRegression(project, entryId);
      if (reg) {
        client.labels = [reg.label];
        client.leadLines = [reg.line];
      }
    }
    const sentryRefs = parseSentryRefs(data.sentry);
    if (sentryRefs.length) client.tailBlocks = sentryAdf(await sentryFrames(projectId, sentryRefs));
    const local = data.fromDefectId ? await db.defect.findFirst({ where: { id: data.fromDefectId, projectId } }) : null;
    if (data.fromDefectId && !local) throw new UserError("That bug isn't in this test cycle anymore.");
    if (local?.externalKey) throw new UserError(`That bug is already ${local.externalKey} in Jira.`);
    const { ctx } = await bugContext(projectId, entryId, data.stepIndex, data.actual);
    // The tester is the bug's Reporter in Jira. When that can't be set, their name goes in the description.
    const account = await jiraAccountOf(client, user);
    const tester = user.name ?? user.email;
    const found = data.attachmentIds.length ? await db.attachment.findMany({ where: { id: { in: data.attachmentIds }, projectId } }) : [];
    // In the order the tester ticked them.
    const files = data.attachmentIds.flatMap((id) => found.filter((f) => f.id === id));
    const template = data.template && (await templateOf(projectId)) ? data.template : null;
    const imported = data.imported ? await importedOf(projectId) : null;
    let key: string, reporterSet: boolean;
    let attachError: string | null = null;
    let linkError: string | null = null;
    let summary = data.summary;
    if (imported && data.imported) {
      const typed = data.imported;
      summary = importedTitle(imported.title, typed);
      // Only the template's own fields, converted by their type on Jira's create screen.
      const meta = await client.createMeta().catch(() => null);
      const fields: Record<string, { name: string; value: unknown }> = {};
      const extra: { name: string; text: string }[] = [];
      for (const f of imported.fields) {
        const value = (typed.fields[f.id] ?? []).map((v) => v.trim()).filter(Boolean);
        if (!value.length) continue;
        const m = metaFor(meta, f);
        // A version Jira doesn't have (or a picker with no choices) goes in the description, as the dialog said.
        const known = m && (m.options.length ? value.every((v) => m.options.includes(v)) : !isPick(m));
        const jira = m && known ? jiraValue(m, m.schema.type === "array" ? value : value[0]) : undefined;
        if (m && jira !== undefined) fields[m.id] = { name: f.name, value: jira };
        else extra.push({ name: f.name, text: value.join(", ") });
      }
      const valueOf = new Map(imported.fields.map((f) => [f.name, (typed.fields[f.id] ?? []).join(", ")]));
      const sections = imported.sections.filter((x) => x.source !== "empty").map((x) => ({ heading: x.heading, text: typed.sections.find((t) => t.heading === x.heading)?.text ?? "" }));
      const trace = { label: `${ctx.caseKey} in ${ctx.runLabel}`, link: ctx.link };
      ({ key, reporterSet } = await client.createIssue({
        summary,
        description: (left) =>
          importedAdf(sections, {
            reportedBy: account && left.reporterSet ? null : tester,
            extra: [...extra, ...left.dropped.filter((n) => valueOf.get(n)).map((n) => ({ name: n, text: valueOf.get(n)! }))],
            trace,
          }),
        severity: data.severity,
        reporterId: account?.accountId,
        fields,
      }));
      try {
        await client.attach(key, files.map((f) => ({ fileName: f.fileName, contentType: f.contentType, data: f.data })));
      } catch (e) {
        attachError = e instanceof Error ? e.message : "Attachments failed to upload.";
      }
    } else if (template) {
      summary = templateTitle(template);
      ({ key, reporterSet, attachError, linkError } = await fileTemplateBug(client, template, data.severity, account, tester, files, {
        label: `${ctx.caseKey} in ${ctx.runLabel}`,
        link: ctx.link,
      }));
      await rememberAnswers(user.id, user.bugProfile, template);
    } else {
      summary ||= defaultSummary(ctx);
      ({ key, reporterSet } = await client.createIssue({
        summary,
        description: (left) => bugAdf(account && left.reporterSet ? ctx : { ...ctx, reportedBy: tester }),
        severity: data.severity,
        reporterId: account?.accountId,
      }));
      try {
        await client.attach(key, files.map((f) => ({ fileName: f.fileName, contentType: f.contentType, data: f.data })));
      } catch (e) {
        attachError = e instanceof Error ? e.message : "Attachments failed to upload.";
      }
    }
    const reporterNote =
      account && !reporterSet
        ? `Jira wouldn't let Flaw Patrol set you as the reporter of ${key}, so your name is in its description instead. Ask a Flaw Patrol admin to check Settings → Jira.`
        : null;
    const issue = await client.getIssue(key).catch(() => ({ key, summary, status: "", category: "new", url: `${client.creds.siteUrl}/browse/${key}`, severity: null, priority: "", type: "", parent: null }));
    // A bug saved here first keeps its number, runs and history, and now points at Jira.
    const defect = local
      ? await db.defect.update({
          where: { id: local.id },
          data: {
            externalKey: issue.key,
            title: issue.summary || summary,
            externalUrl: issue.url,
            externalStatus: issue.status || null,
            externalCategory: issue.category || null,
            externalPriority: issue.priority || null,
            severity: issue.severity ?? data.severity,
            status: issue.category === "done" ? "FIXED" : local.status,
            syncedAt: new Date(),
          },
        })
      : await upsertFromIssue(projectId, issue, user, data.severity);
    if (local) revalidatePath(`/p/${project.key}`, "layout");
    // Only stories the case really links.
    if (data.stories.length) {
      const own = await db.runEntry.findFirst({ where: { id: entryId }, select: { testCase: { select: { jiraStories: true } } } });
      const failed: string[] = [];
      for (const story of data.stories.filter((k) => own?.testCase.jiraStories.includes(k))) await client.relate(key, story).catch(() => failed.push(story));
      if (failed.length) linkError = [linkError, `${key} was created, but Jira wouldn't link it to ${failed.join(", ")}.`].filter(Boolean).join(" ");
    }
    await alertBugFiled(project, { key, url: issue.url, title: issue.summary || summary, severity: data.severity }, { tester, caseKey: ctx.caseKey, step: data.stepIndex }).catch(() => {});
    return { defect: toLinked(defect), attachError, reporterNote, linkError };
  });
}

/** Keep this tester's Context, User name & ID and tenant for their next bug on this client. */
async function rememberAnswers(userId: string, current: unknown, b: TemplateBug) {
  const tag = b.clientTag.trim() || "_";
  const profile = parseProfile(current);
  profile[tag] = { context: b.history.context.trim(), user: b.history.user.trim(), tenant: tenantOf(b.history.envTenant) };
  await db.user.update({ where: { id: userId }, data: { bugProfile: profile } });
}

/** When Jira isn't connected: record the defect here only. */
export async function createLocalDefect(projectId: string, input: { title: string; severity: Severity }) {
  return wrap(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const title = z.string().trim().min(1, "Add a title").max(300).parse(input.title);
    const { defectSeq } = await db.project.update({ where: { id: projectId }, data: { defectSeq: { increment: 1 } } });
    const defect = await db.defect.create({
      data: { projectId, number: defectSeq, title, severity: input.severity, createdById: user.id, createdBy: user.name ?? user.email },
    });
    return { defect: toLinked(defect) };
  });
}

export async function refreshFromJira(projectId: string) {
  return wrap(async () => {
    const { project } = await requireProjectAction(projectId, "run:execute");
    const res = await refreshDefectStatuses(projectId, true);
    revalidatePath(`/p/${project.key}`, "layout");
    return res;
  });
}

/** Refresh from Jira on the umbrella's Bugs page (ver_91): every test cycle it can see. */
export async function refreshFromJiraMany(projectIds: string[]) {
  return wrap(async () => {
    let refreshed = 0;
    const failed: string[] = [];
    for (const id of projectIds.slice(0, 200)) {
      const { project } = await requireProjectAction(id, "run:execute").catch(() => ({ project: null }));
      if (!project) continue;
      const res = await refreshDefectStatuses(id, true);
      refreshed += res.refreshed;
      failed.push(...res.failed);
      revalidatePath(`/p/${project.key}`, "layout");
    }
    revalidatePath("/g", "layout");
    return { refreshed, failed };
  });
}

/** Preview data for the bug dialog, so the tester sees what will be filed. */
export async function previewJiraBug(projectId: string, entryId: string, stepIndex: number | null, actual: string) {
  return wrap(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const { ctx, entry } = await bugContext(projectId, entryId, stepIndex, actual);
    const client = await jiraFor(projectId);
    const reporter = client ? await reporterInfo(client, user) : null;
    const { bugText } = await import("@/lib/jira-format");
    const t = client ? await templateOf(projectId) : null;
    const template = t && client ? templateDefaults(t, entry, ctx, await client.createMeta().catch(() => null), user.bugProfile) : null;
    const imp = client ? await importedOf(projectId) : null;
    const imported = imp && client ? importedDraft(imp, entry, ctx, await client.createMeta().catch(() => null)) : null;
    return { summary: defaultSummary(ctx), body: bugText(reporter?.found === false ? { ...ctx, reportedBy: user.name ?? user.email } : ctx), reporter, template, imported, scale: client?.scale ?? PLAIN_SCALE };
  });
}

/**
 * For Settings → Jira: can the connected account set each bug's Reporter, and
 * which members have no Jira account under their email.
 */
export async function checkJiraReporters(projectId: string) {
  return wrap(async () => {
    await requireProjectAction(projectId, "jira:manage");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    const members = await db.projectMember.findMany({
      where: { projectId },
      select: { user: { select: { name: true, email: true, jiraEmail: true } } },
      orderBy: { user: { email: "asc" } },
      take: 100,
    });
    const [owner, canSet, found] = await Promise.all([
      client.owner(),
      client.canSetReporter().catch(() => false),
      Promise.all(members.map(async (m) => ({ person: m.user, account: await jiraAccountOf(client, m.user) }))),
    ]);
    const missing = found.filter((f) => !f.account).map((f) => ({ name: f.person.name ?? f.person.email, email: jiraEmailOf(f.person) }));
    return { owner, canSet, total: members.length, missing };
  });
}

/** Your Jira account as Flaw Patrol finds it, on the first Jira site among your projects. */
async function myJiraMatch(p: Person & { id: string }) {
  const cfg = await db.jiraConfig.findFirst({ where: { project: { archivedAt: null, members: { some: { userId: p.id } } } }, select: { projectId: true, siteUrl: true } });
  if (!cfg) return { site: null, name: null };
  const client = await jiraFor(cfg.projectId).catch(() => null);
  if (!client) return { site: cfg.siteUrl, name: null };
  return { site: cfg.siteUrl, name: (await jiraAccountOf(client, p))?.displayName ?? null };
}

export async function checkMyJira() {
  return wrap(async () => myJiraMatch(await requireUser()));
}

/** Save the email of your Jira account (blank: use your Flaw Patrol email), then look it up. */
export async function saveMyJiraEmail(input: string) {
  return wrap(async () => {
    const user = await requireUser();
    const email = z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter an email address, or leave it blank")]).parse(input.trim());
    const jiraEmail = email && email !== user.email.toLowerCase() ? email : null;
    await db.user.update({ where: { id: user.id }, data: { jiraEmail } });
    return { jiraEmail, ...(await myJiraMatch({ ...user, jiraEmail })) };
  });
}

const settingsSchema = z.object({
  on: z.boolean(),
  clientTag: z.string().trim().max(40).default(""),
  team: z.string().trim().max(100).default(""),
  clients: z.array(z.string().trim().max(100)).max(30).default([]),
  olyEnv: z.array(z.string().trim().max(100)).max(30).default([]),
});

/** Turn the team bug template on or off for a project, and set its defaults. */
export async function saveBugTemplate(projectId: string, input: z.input<typeof settingsSchema>, opts: { keepShared?: boolean } = {}) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const data = settingsSchema.parse(input);
    // The detailed layout replaces an imported one; turning the template off keeps the import for later.
    const old = parseTemplateSettings((await db.jiraConfig.findUnique({ where: { projectId }, select: { bugTemplate: true } }))?.bugTemplate);
    const clientTag = data.clientTag.replace(/^\[|\]$/g, "").toUpperCase();
    // With a company template picked (ver_96), only this place's defaults change; the layout stays shared.
    const bugTemplate = opts.keepShared ? { ...old, clientTag, team: data.team, clients: data.clients, olyEnv: data.olyEnv } : { ...data, imported: data.on ? null : old.imported, clientTag };
    const done = await db.jiraConfig.updateMany({ where: { projectId }, data: { bugTemplate, ...(!opts.keepShared && { sharedTemplateId: null }) } });
    if (!done.count) throw new UserError("Connect Jira first.");
    revalidatePath(`/p/${project.key}/settings`);
    await logActivity({ actor: user, kind: "settings", action: data.on ? "Changed the bug template" : "Turned off the bug template", project });
    return {};
  });
}

/**
 * For Settings → Jira: which template fields the connected Jira has on its
 * create screen, their options, and defaults guessed from the project name.
 */
export async function checkBugTemplate(projectId: string) {
  return wrap(async () => {
    const { project } = await requireProjectAction(projectId, "jira:manage");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    const meta = await client.createMeta(true);
    const fields = ["Severity", ...Object.values(FIELD)].map((name) => {
      const f = findField(meta, name);
      return { name, found: !!f, required: !!f?.required, options: f?.options ?? [], kind: f ? (f.options.length ? "options" : f.schema.type === "date" ? "date" : f.schema.custom?.endsWith(":textarea") ? "rich text" : "text") : "" };
    });
    // Required fields the template doesn't fill would get every bug refused.
    const covered = new Set(["summary", "description", "project", "issuetype", "reporter", "severity", ...Object.values(FIELD).map((n) => n.toLowerCase())]);
    const uncovered = meta.filter((f) => f.required && !covered.has(f.id.toLowerCase()) && !covered.has(f.name.trim().toLowerCase())).map((f) => f.name);
    const word = clientIn(project.name);
    const opt = (n: string, w: string) => optionLike(findField(meta, n)?.options ?? [], w);
    return { fields, uncovered, guess: { clientTag: word.toUpperCase(), team: opt(FIELD.team, word), clients: [opt(FIELD.clients, word)].filter(Boolean) } };
  });
}

/** Fields an example bug always has that aren't part of a layout. */
const NOT_LAYOUT = new Set(["summary", "description", "project", "issuetype", "reporter", "assignee", "attachment", "issuelinks", "parent", "priority", "watches", "votes", "comment", "worklog", "timetracking", "subtasks", "status", "creator", "created", "updated"]);

/**
 * Settings → Jira → Bug template: read one example bug and work out its layout,
 * the title shape, its description headings and the Jira fields it used, with a
 * first guess at where each one's value comes from. Only the layout is kept,
 * never the example's words.
 */
export async function readBugTemplate(projectId: string, input: string) {
  return wrap(async () => {
    await requireProjectAction(projectId, "jira:manage");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Connect Jira first.");
    const key = parseIssueKey(input);
    if (!key) throw new UserError("Paste a Jira bug key like QA-418, or its link.");
    const ex = await client.readExample(key).catch((e) => {
      if (e instanceof JiraError && /Not found/.test(e.message)) throw new UserError(`Jira has no bug ${key}, or this account can't see it.`);
      throw e;
    });
    if (ex.project.toUpperCase() !== client.creds.jiraProjectKey.toUpperCase())
      throw new UserError(`${key} is in Jira project ${ex.project}. Pick a bug from ${client.creds.jiraProjectKey}, the Jira project set above.`);
    const meta = await client.createMeta(true);
    const sev = await client.severityField();
    const fields: ImportedTemplate["fields"] = [];
    for (const m of meta) {
      if (NOT_LAYOUT.has(m.id) || m.id === sev) continue;
      const value = exampleValue(ex.fields[m.id]);
      // A kind of field Flaw Patrol can't fill (people, cascading lists) is left to Jira.
      if (value === null || jiraValue(m, value.length ? value : ["x"]) === undefined) continue;
      if (!value.length && !m.required) continue;
      const source = guessField(m.name, value.length > 0);
      fields.push({ id: m.id, name: m.name, required: m.required, source, value: source === "default" ? value : [] });
    }
    const pattern = titlePattern(ex.summary);
    const template: ImportedTemplate = {
      from: ex.key,
      title: { tag: pattern.tag, feature: pattern.feature },
      sections: adfHeadings(ex.description).map((heading) => ({ heading, source: guessSection(heading) })),
      fields,
    };
    // Options and examples for the check screen.
    const options = Object.fromEntries(fields.map((f) => [f.id, { options: meta.find((m) => m.id === f.id)?.options ?? [], example: exampleValue(ex.fields[f.id]) ?? [] }]));
    return { template, exampleTitle: ex.summary, options };
  });
}

const importedSchema = z.object({
  from: z.string().trim().min(1).max(40),
  title: z.object({ tag: z.boolean(), feature: z.boolean() }),
  sections: z.array(z.object({ heading: z.string().trim().min(1).max(120), source: z.enum(Object.keys(SECTION_SOURCES) as [keyof typeof SECTION_SOURCES]) })).max(40),
  fields: z
    .array(
      z.object({
        id: z.string().max(60),
        name: z.string().max(120),
        required: z.boolean(),
        source: z.enum(Object.keys(FIELD_SOURCES) as [keyof typeof FIELD_SOURCES]),
        value: z.array(z.string().max(500)).max(30),
      }),
    )
    .max(60),
});

/** Save an imported template: new bugs from this test cycle use its layout. */
export async function saveImportedTemplate(projectId: string, input: z.input<typeof importedSchema>) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const imported = importedSchema.parse(input);
    const row = await db.jiraConfig.findUnique({ where: { projectId }, select: { bugTemplate: true } });
    if (!row) throw new UserError("Connect Jira first.");
    const old = parseTemplateSettings(row.bugTemplate);
    await db.jiraConfig.update({ where: { projectId }, data: { bugTemplate: { ...old, on: true, imported }, sharedTemplateId: null } });
    revalidatePath(`/p/${project.key}/settings`);
    revalidatePath("/g", "layout");
    await logActivity({ actor: user, kind: "settings", action: "Imported a bug template from Jira", project });
    return {};
  });
}

/** Go back to the plain layout. An imported template is kept, so it can be turned on again. */
export async function setPlainLayout(projectId: string) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const row = await db.jiraConfig.findUnique({ where: { projectId }, select: { bugTemplate: true } });
    if (!row) throw new UserError("Connect Jira first.");
    await db.jiraConfig.update({ where: { projectId }, data: { bugTemplate: { ...parseTemplateSettings(row.bugTemplate), on: false }, sharedTemplateId: null } });
    revalidatePath(`/p/${project.key}/settings`);
    revalidatePath("/g", "layout");
    await logActivity({ actor: user, kind: "settings", action: "Switched bugs to the plain layout", project });
    return {};
  });
}
