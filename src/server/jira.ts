"use server";

import { JIRA_FILE_LIMIT } from "@/lib/jira-files";
import { parseSentryRefs, sentryAdf } from "@/lib/sentry";
import { sentryFrames } from "./sentry";
import { logActivity } from "@/lib/activity";
import { Prisma, type Severity } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { forgetBugBoard } from "@/lib/bug-board-server";
import { seal } from "@/lib/crypto";
import {
  adfHeadings,
  clientIn,
  exampleValue,
  featureOf,
  FIELD,
  FIXED_FIELDS,
  QUIET_FIELDS,
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
import { addRowToAdf, answersAdf, bugAdf, defaultSummary, importedAdf, parseIssueKey, sectionText, templateAdf, type BugContext, type FileRef } from "@/lib/jira-format";
import { requireProjectAction, requireUser } from "@/lib/session";
import { DEFAULT_SEVERITY, PLAIN_SCALE, SEVERITIES, severitySchema, type SeverityConfig } from "@/lib/severity";
import { alertBugFiled } from "@/lib/slack";
import { attempt, UserError } from "./result";
import { jiraConfigFor } from "@/lib/umbrella";
import { entryRegression } from "@/lib/regression-data";
import { bugContext } from "@/lib/bug-context";
import { draftToOko } from "@/lib/oko-draft";
import { answersText, CURRENT_ID, layoutFromImported, layoutFromSettings, layoutTitle, listWords, missing, parseAnswers, parseLayout, PLAIN_ID, plainLayout, SAVED_ID, withFileNames, type Answer, type BugLayout, type RunFill } from "@/lib/bug-layout";
import { currentLayout, templateHome } from "@/lib/bug-templates-data";
import { FOUND_IN_FIELDS, foundInDraft, foundInRelease, matchVersion, parseFoundIn, type FoundInDraft } from "@/lib/found-in";

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
    // A new connection reads its severity names from a field called Severity, when the bug screen has one.
    const severity = existing?.severity ? undefined : await detectSeverity(client);
    await db.jiraConfig.upsert({ where: { projectId }, create: { projectId, ...row, ...(severity && { severity }) }, update: { ...row, ...(severity && { severity }) } });
    revalidatePath(`/p/${project.key}`, "layout");
    revalidatePath("/g", "layout");
    await logActivity({ actor: user, kind: "settings", action: existing ? "Changed Jira connection" : "Connected Jira", project, detail: [`${normalizeSite(data.siteUrl).replace(/^https?:\/\//, "")} · ${data.jiraProjectKey}`, data.token && existing && "API token replaced"].filter(Boolean).join(" · ") });
    return { connectedAs: who };
  });
}

/** The bug screen's Severity field and its values, or null when there isn't one with a list. */
async function detectSeverity(client: JiraClient, known?: MetaField[]): Promise<SeverityConfig | null> {
  const meta = known ?? (await client.fieldMeta(true).catch(() => null));
  const f = meta?.find((x) => x.name.trim().toLowerCase() === "severity" && x.options.length > 0);
  if (!f) return null;
  const values = f.options.slice(0, SEVERITIES.length);
  return { fieldId: f.id, fieldName: f.name, values, critical: values.slice(0, Math.min(2, values.length - 1)) };
}

/**
 * A connection that never found a Severity field (it was only on Jira's Edit
 * screen, before ver_143) picks it up now, so bugs use Jira's own severity names.
 * True when it was just saved.
 */
async function ensureSeverity(projectId: string, client: JiraClient, meta: MetaField[]) {
  const cfg = await jiraConfigFor(projectId);
  if (!cfg || cfg.severity) return false;
  const severity = await detectSeverity(client, meta);
  if (!severity) return false;
  await db.jiraConfig.update({ where: { projectId: cfg.projectId }, data: { severity } });
  revalidatePath("/p", "layout");
  revalidatePath("/g", "layout");
  return true;
}

/** Settings → Jira connection → Jira Priority: the priorities Jira lists, what's saved, and what new bugs get. */
export async function jiraPriorities(projectId: string) {
  return wrap(async () => {
    await requireProjectAction(projectId, "jira:manage");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    const meta = await client.fieldMeta();
    const f = meta.find((m) => m.id === "priority");
    const setting = parseTemplateSettings((await jiraConfigFor(projectId))?.bugTemplate).priority;
    return { options: f?.options ?? [], onScreen: !!f, required: !!f?.required, setting, current: await client.priorityName(meta) };
  });
}

const prioritySchema = z.string().trim().max(100);

/** Save the Jira Priority new bugs get; "" leaves it to Jira. */
export async function saveJiraPriority(projectId: string, input: string) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const priority = prioritySchema.parse(input);
    const row = await db.jiraConfig.findUnique({ where: { projectId }, select: { bugTemplate: true } });
    if (!row) throw new UserError("This test cycle uses its umbrella's Jira. Change the priority in the umbrella's settings.");
    await db.jiraConfig.update({ where: { projectId }, data: { bugTemplate: { ...parseTemplateSettings(row.bugTemplate), priority } } });
    revalidatePath(`/p/${project.key}/settings`);
    revalidatePath("/g", "layout");
    await logActivity({ actor: user, kind: "settings", action: "Changed the Jira priority for new bugs", project, detail: priority || "Left to Jira" });
    return {};
  });
}

/** Settings → Jira → Severity field: the bug screen's fields that have a list of values. */
export async function jiraSeverityFields(projectId: string) {
  return wrap(async () => {
    await requireProjectAction(projectId, "jira:manage");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    const meta = await client.fieldMeta(true);
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
      const f = (await client.fieldMeta(true)).find((x) => x.id === data.fieldId);
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

/** The release this run entry was testing: the run's Release, else its bug bash's, else the test cycle's release name. */
async function entryRelease(entry: { run: { id: string; release: string; project: { rcName: string } } }) {
  const bash = entry.run.release.trim() ? null : await db.bugBash.findUnique({ where: { runId: entry.run.id }, select: { release: true } });
  return foundInRelease({ run: entry.run.release, bash: bash?.release, cycle: entry.run.project.rcName });
}

/** Found-in version for a new bug from this entry, or null when the setting is off. */
async function foundInFor(client: JiraClient, entry: Entry): Promise<FoundInDraft | null> {
  const cfg = parseFoundIn(client.creds.foundIn);
  if (!cfg) return null;
  const [versions, meta, release] = await Promise.all([client.versionList().catch(() => []), client.fieldMeta().catch(() => null), entryRelease(entry)]);
  const f = meta?.find((x) => x.id === cfg.field);
  return foundInDraft(cfg, versions, release, { onScreen: !meta || !!f, label: f?.name });
}

/**
 * Set the version the next issue is filed with: the one picked in the bug box (chosen), or the
 * release picked for you when the box didn't say. Returns what the bug keeps as its found-in.
 */
async function applyFoundIn(client: JiraClient, entryId: string, projectId: string, chosen: string | null | undefined) {
  client.foundIn = null;
  if (!parseFoundIn(client.creds.foundIn) || chosen === null || chosen === "") return "";
  const { entry } = await bugContext(projectId, entryId, null, "");
  const d = await foundInFor(client, entry);
  if (!d) return "";
  const value = chosen === undefined ? d.value : chosen;
  if (!value) return "";
  const match = matchVersion([...d.current, ...d.older].map((name) => ({ name, released: false })), value);
  client.foundIn = { field: d.field, label: d.label, value: match?.name ?? value, known: !!match };
  return match?.name ?? value;
}

/** The bug box's Found in line: the version picked for you and Jira's list, or null when it's off. */
export async function previewFoundIn(projectId: string, entryId: string) {
  return wrap(async () => {
    await requireProjectAction(projectId, "run:execute");
    const client = await jiraFor(projectId);
    if (!client) return { foundIn: null };
    const { entry } = await bugContext(projectId, entryId, null, "");
    return { foundIn: await foundInFor(client, entry) };
  });
}

const foundInSchema = z.object({ field: z.enum(["versions", "fixVersions"]).nullable() });

/** Settings → Jira → Found-in version: whether the field is on the create screen, and Jira's versions. */
export async function checkFoundIn(projectId: string, field: "versions" | "fixVersions") {
  return wrap(async () => {
    await requireProjectAction(projectId, "jira:manage");
    const client = await jiraFor(projectId);
    if (!client) throw new UserError("Jira isn't connected for this test cycle.");
    const picked = foundInSchema.parse({ field }).field ?? "versions";
    const [meta, versions] = await Promise.all([client.fieldMeta(true), client.versionList().catch(() => null)]);
    const f = meta.find((x) => x.id === picked);
    return { onScreen: !!f, label: f?.name ?? FOUND_IN_FIELDS[picked].label, project: client.creds.jiraProjectKey, versions: versions?.map((v) => v.name) ?? null };
  });
}

/** Turn the found-in version on (with its field) or off. */
export async function saveFoundIn(projectId: string, input: z.input<typeof foundInSchema>) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const data = foundInSchema.parse(input);
    const cfg = await jiraConfigFor(projectId);
    if (!cfg) throw new UserError("Connect Jira first.");
    if (cfg.projectId !== projectId) throw new UserError("This test cycle uses its umbrella's Jira. Change the found-in version in the umbrella's settings.");
    await db.jiraConfig.update({ where: { projectId }, data: { foundIn: data.field ? { field: data.field } : Prisma.DbNull } });
    revalidatePath(`/p/${project.key}`, "layout");
    revalidatePath("/g", "layout");
    await logActivity({ actor: user, kind: "settings", action: "Changed the found-in version", project, detail: data.field ? FOUND_IN_FIELDS[data.field].label : "Off" });
    return { field: data.field };
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
  /** A whole-case bug's first failed step: its steps and Expected go in the description. */
  focus: z.number().int().min(0).nullable().default(null),
  actual: z.string().max(10000).default(""),
  attachmentIds: z.array(z.string()).max(20).default([]),
  /** Stories of the case to link the new bug to, with Jira's "relates to". */
  stories: z.array(z.string().max(30)).max(10).default([]),
  /** A bug bash find's build and environment when it was logged (ver_172), over the run's current ones. */
  runAs: z.object({ build: z.string().trim().max(120), environment: z.string().trim().max(120) }).optional(),
  /** Regression flag: add the Jira label and the passed-in / fails-in builds line. */
  regression: z.boolean().default(false),
  /** Send to Jira: the bug saved here before Jira was connected, which becomes the new issue. */
  fromDefectId: z.string().optional(),
  /** Sentry errors: a section at the end of the description. */
  sentry: z.array(z.unknown()).max(20).default([]),
  template: templateSchema.optional(),
  /** Found-in version: left out = the release picked for you, null or "" = leave it out. */
  foundIn: z.string().trim().max(255).nullable().optional(),
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

/** "Filed from Flaw Patrol: APP-12 in run R3": a written bug (no case) points at the Bugs page instead. */
const traceOf = (ctx: BugContext) => ({ label: ctx.caseKey ? `${ctx.caseKey} in ${ctx.runLabel}` : "written on the Bugs page", link: ctx.link });

/** Fields where Jira only takes one of its own choices: versions, components and options. */
const isPick = (m: MetaField | undefined) => !!m && [m.schema.type, m.schema.items].some((t) => t === "version" || t === "component" || t === "option");

function importedDraft(t: ImportedTemplate, entry: Entry, ctx: BugContext, meta: MetaField[] | null): ImportedDraft {
  const run = entry.run;
  return {
    title: t.title,
    // Since ver_96 a leading [IOS] is a case tag, not part of the title.
    tag: tagOf(entry.title) || (ctx.titleTags?.[0] ?? "").toUpperCase() || clientIn(`${run.name} ${run.project.name}`).toUpperCase(),
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
  const clientTag = t.clientTag || tagOf(entry.title) || (ctx.titleTags?.[0] ?? "").toUpperCase() || word.toUpperCase();
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
  return { bug, options, web: /^web/i.test(clientName), trace: traceOf(ctx) };
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
    [FIELD.toBeAutomated, FIXED_FIELDS.toBeAutomated!],
    [FIELD.statusUpdate, FIXED_FIELDS.statusUpdate!],
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
  const meta = await client.fieldMeta().catch(() => null);
  const fields: Record<string, { name: string; value: unknown }> = {};
  const extra: { name: string; text: string }[] = [];
  for (const [name, value] of templateValues(b)) {
    const f = findField(meta, name);
    const list = (Array.isArray(value) ? value : [value]).filter((x) => x.trim());
    // An option Jira doesn't list would get the whole bug refused.
    const known = !f?.options.length || list.every((x) => f.options.includes(x));
    const jira = f && known ? jiraValue(f, value) : undefined;
    if (f && jira !== undefined) fields[f.id] = { name, value: jira };
    else if (!QUIET_FIELDS.has(name) && asText(value).trim()) extra.push({ name, text: asText(value) });
  }
  const valueOf = new Map(templateValues(b).map(([n, v]) => [n, asText(v)]));
  const sorted = friendlyNames([...orderFiles(files).media, ...orderFiles(files).logs], b);
  const describe = (reporterSet: boolean, dropped: string[], refs: FileRef[]) =>
    templateAdf(b, {
      reportedBy: account && reporterSet ? null : tester,
      files: refs,
      extra: [...extra, ...dropped.filter((n) => valueOf.has(n) && !QUIET_FIELDS.has(n)).map((n) => ({ name: n, text: valueOf.get(n)! }))],
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
      const { added, note } = await client.attachEach(key, sorted);
      attachError = note;
      // A file that stayed in Flaw Patrol (too big for Jira) isn't listed on the Jira bug.
      const kept = sorted.flatMap((f, i) => (added[i] ? [{ f, a: added[i] }] : []));
      const refs: FileRef[] = kept.map(({ f, a }) => ({ fileName: f.fileName, contentType: f.contentType, url: client.attachmentUrl(a.id, a.filename) }));
      const withMedia = await Promise.all(
        refs.map(async (r, i) => (/^(image|video)\//.test(r.contentType) ? { ...r, mediaId: (await client.mediaId(kept[i].a.id)) ?? undefined } : r)),
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
    const { ctx } = await bugContext(projectId, entryId, data.stepIndex, data.actual, data.focus);
    if (data.runAs) Object.assign(ctx, data.runAs);
    // The tester is the bug's Reporter in Jira. When that can't be set, their name goes in the description.
    const account = await jiraAccountOf(client, user);
    const tester = user.name ?? user.email;
    const found = data.attachmentIds.length ? await db.attachment.findMany({ where: { id: { in: data.attachmentIds }, projectId } }) : [];
    // In the order the tester ticked them.
    const files = data.attachmentIds.flatMap((id) => found.filter((f) => f.id === id));
    const template = data.template && (await templateOf(projectId)) ? data.template : null;
    const imported = data.imported ? await importedOf(projectId) : null;
    const foundIn = await applyFoundIn(client, entryId, projectId, data.foundIn);
    let key: string, reporterSet: boolean;
    let attachError: string | null = null;
    let linkError: string | null = null;
    let summary = data.summary;
    if (imported && data.imported) {
      const typed = data.imported;
      summary = importedTitle(imported.title, typed);
      // Only the template's own fields, converted by their type on Jira's create screen.
      const meta = await client.fieldMeta().catch(() => null);
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
      const trace = traceOf(ctx);
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
      attachError = (await client.attachEach(key, files.map((f) => ({ fileName: f.fileName, contentType: f.contentType, data: f.data })))).note;
    } else if (template) {
      summary = templateTitle(template);
      ({ key, reporterSet, attachError, linkError } = await fileTemplateBug(client, template, data.severity, account, tester, files, traceOf(ctx)));
      await rememberAnswers(user.id, user.bugProfile, template);
    } else {
      summary ||= defaultSummary(ctx);
      ({ key, reporterSet } = await client.createIssue({
        summary,
        description: (left) => bugAdf(account && left.reporterSet ? ctx : { ...ctx, reportedBy: tester }),
        severity: data.severity,
        reporterId: account?.accountId,
      }));
      attachError = (await client.attachEach(key, files.map((f) => ({ fileName: f.fileName, contentType: f.contentType, data: f.data })))).note;
    }
    const reporterNote =
      account && !reporterSet
        ? `Jira wouldn't let Flaw Patrol set you as the reporter of ${key}, so your name is in its description instead. Ask a Flaw Patrol admin to check Settings → Jira.`
        : null;
    const issue = await client.getIssue(key).catch(() => ({ key, summary, status: "", category: "new", url: `${client.creds.siteUrl}/browse/${key}`, severity: null, priority: "", type: "", parent: null, foundIn: null as string | null }));
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
    if (foundIn) await db.defect.update({ where: { id: defect.id }, data: { foundIn: issue.foundIn || foundIn } });
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
/** The release a bug saved here (no Jira) was found in, from its run entry. */
async function localRelease(projectId: string, entryId: string | undefined) {
  if (!entryId) return "";
  const entry = await db.runEntry.findFirst({ where: { id: entryId, run: { projectId } }, select: { run: { select: { id: true, release: true, project: { select: { rcName: true } } } } } });
  return entry ? (await entryRelease(entry)).name.slice(0, 255) : "";
}

export async function createLocalDefect(projectId: string, input: { title: string; severity: Severity; description?: string; entryId?: string; foundIn?: string }) {
  return wrap(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const title = z.string().trim().min(1, "Add a summary").max(300).parse(input.title);
    const description = z.string().max(20000).default("").parse(input.description ?? "").trim();
    const foundIn = z.string().trim().max(255).default("").parse(input.foundIn ?? "") || (await localRelease(projectId, input.entryId));
    const { defectSeq } = await db.project.update({ where: { id: projectId }, data: { defectSeq: { increment: 1 } } });
    const defect = await db.defect.create({
      data: { projectId, number: defectSeq, title, description, severity: input.severity, createdById: user.id, createdBy: user.name ?? user.email, foundIn },
    });
    return { defect: toLinked(defect) };
  });
}

/**
 * Report a bug without Jira (persona audit #4): the summary and the What happened text,
 * filled from the run's details and the failed step, for the tester to change before saving.
 */
export async function previewLocalBug(projectId: string, entryId: string, stepIndex: number | null, actual: string, focus: number | null = null) {
  return wrap(async () => {
    await requireProjectAction(projectId, "run:execute");
    const { ctx } = await bugContext(projectId, entryId, stepIndex, actual, focus);
    const { bugText } = await import("@/lib/jira-format");
    const blank = ctx.failedIndex === null && !actual.trim();
    return { summary: blank ? "" : defaultSummary(ctx), body: bugText({ ...ctx, link: null }) };
  });
}

export async function refreshFromJira(projectId: string) {
  return wrap(async () => {
    const { project } = await requireProjectAction(projectId, "run:execute");
    const res = await refreshDefectStatuses(projectId, true);
    forgetBugBoard(projectId);
    revalidatePath(`/p/${project.key}`, "layout");
    return res;
  });
}

/** Refresh from Jira on the umbrella's Bugs page: every test cycle it can see. */
export async function refreshFromJiraMany(projectIds: string[]) {
  return wrap(async () => {
    let refreshed = 0;
    const failed: string[] = [];
    for (const id of projectIds.slice(0, 200)) {
      const { project } = await requireProjectAction(id, "run:execute").catch(() => ({ project: null }));
      if (!project) continue;
      const res = await refreshDefectStatuses(id, true);
      forgetBugBoard(id);
      refreshed += res.refreshed;
      failed.push(...res.failed);
      revalidatePath(`/p/${project.key}`, "layout");
    }
    revalidatePath("/g", "layout");
    return { refreshed, failed };
  });
}

/** Preview data for the bug dialog, so the tester sees what will be filed. */
export async function previewJiraBug(projectId: string, entryId: string, stepIndex: number | null, actual: string, focus: number | null = null) {
  return wrap(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const { ctx, entry } = await bugContext(projectId, entryId, stepIndex, actual, focus);
    let client = await jiraFor(projectId);
    // A Severity field found since the connection was made (on Jira's Edit screen) gives the bug Jira's own names.
    if (client && !client.creds.severity && (await ensureSeverity(projectId, client, await client.fieldMeta().catch(() => [])).catch(() => false))) client = await jiraFor(projectId);
    const reporter = client ? await reporterInfo(client, user) : null;
    const { bugText } = await import("@/lib/jira-format");
    const t = client ? await templateOf(projectId) : null;
    const template = t && client ? templateDefaults(t, entry, ctx, await client.fieldMeta().catch(() => null), user.bugProfile) : null;
    const imp = client ? await importedOf(projectId) : null;
    const imported = imp && client ? importedDraft(imp, entry, ctx, await client.fieldMeta().catch(() => null)) : null;
    // Nothing failed and nothing written: an empty summary with a hint, never just the case's title.
    const blank = ctx.failedIndex === null && !actual.trim();
    return { summary: blank ? "" : defaultSummary(ctx), body: bugText(reporter?.found === false ? { ...ctx, reportedBy: user.name ?? user.email } : ctx), reporter, template, imported, scale: client?.scale ?? PLAIN_SCALE, priority: client ? await client.priorityName().catch(() => null) : null, fileLimit: client ? await client.uploadLimit() : JIRA_FILE_LIMIT };
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
    // With a company template picked, only this place's defaults change; the layout stays shared.
    const bugTemplate = opts.keepShared ? { ...old, clientTag, team: data.team, clients: data.clients, olyEnv: data.olyEnv } : { ...data, imported: data.on ? null : old.imported, clientTag, priority: old.priority };
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
    const meta = await client.fieldMeta(true);
    const severitySet = await ensureSeverity(projectId, client, meta);
    const fixed = new Map<string, string>(Object.entries(FIXED_FIELDS).map(([k, v]) => [FIELD[k as keyof typeof FIELD] as string, v ?? ""]));
    const fields: { name: string; found: boolean; required: boolean; options: string[]; kind: string; later: boolean; value?: string }[] = ["Severity", ...Object.values(FIELD)]
      .map((name) => {
        const f = findField(meta, name);
        const kind = f ? (f.options.length ? "options" : f.schema.type === "date" ? "date" : f.schema.custom?.endsWith(":textarea") ? "rich text" : "text") : "";
        return { name, found: !!f, required: !!f?.required, options: f?.options ?? [], kind, later: !!f?.later, ...(f && fixed.has(name) && { value: fixed.get(name) }) };
      })
      // Fields this Jira doesn't have that are simply left out, not written into the description.
      .filter((f) => f.found || !QUIET_FIELDS.has(f.name));
    // The Priority from Settings → Jira fills Jira's own Priority field, and Stakeholder Priority where there is one.
    const priority = await client.priorityName(meta);
    const pf = meta.find((f) => f.id === "priority");
    if (priority && pf) fields.splice(1, 0, { name: "Priority", found: true, required: pf.required, options: pf.options, kind: "options", later: !!pf.later, value: priority });
    const stake = client.stakeholderPriority(meta);
    if (stake) fields.splice(priority && pf ? 2 : 1, 0, { name: stake.field.name, found: true, required: stake.field.required, options: stake.field.options, kind: "options", later: !!stake.field.later, value: stake.value });
    // Required fields the template doesn't fill would get every bug refused.
    const covered = new Set(["summary", "description", "project", "issuetype", "reporter", "severity", ...(priority ? ["priority"] : []), ...Object.values(FIELD).map((n) => n.toLowerCase())]);
    const uncovered = meta.filter((f) => f.required && !covered.has(f.id.toLowerCase()) && !covered.has(f.name.trim().toLowerCase())).map((f) => f.name);
    const word = clientIn(project.name);
    const opt = (n: string, w: string) => optionLike(findField(meta, n)?.options ?? [], w);
    return { fields, uncovered, severitySet, guess: { clientTag: word.toUpperCase(), team: opt(FIELD.team, word), clients: [opt(FIELD.clients, word)].filter(Boolean) } };
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
    return exampleTemplate(projectId, input);
  });
}

/** Settings → Bug templates → New template → Copy a Jira bug's layout. */
export async function readBugLayout(projectId: string, input: string) {
  return wrap(async () => {
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, key: true, groupId: true } });
    await requireProjectAction((await templateHome(project)).id, "bugtemplate:edit");
    const { template } = await exampleTemplate(projectId, input);
    return { layout: layoutFromImported(template) };
  });
}

async function exampleTemplate(projectId: string, input: string) {
  {
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
    const meta = await client.fieldMeta(true);
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
  }
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

// ---- Bug templates ----

/** The template a test cycle's bug uses, from its umbrella's list. */
async function layoutOf(projectId: string, templateId: string) {
  if (templateId === PLAIN_ID) return { name: "Plain", layout: plainLayout() };
  if (templateId === CURRENT_ID) {
    // Write a bug: the test cycle's own layout (a shared OKO layout or a copied Jira bug).
    const layout = layoutFromSettings(parseTemplateSettings((await jiraConfigFor(projectId))?.bugTemplate));
    return layout ? { name: (await currentLayout(projectId)).name, layout } : { name: "Plain", layout: plainLayout() };
  }
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, key: true, groupId: true } });
  const home = await templateHome(project);
  const t = await db.bugTemplate.findFirst({ where: { id: templateId, projectId: home.id } });
  if (!t) throw new UserError("That bug template is gone. Someone may have deleted it. Pick another one.");
  return { name: t.name, layout: parseLayout(t.layout) };
}

/**
 * What a bug template starts with for this case: the text from the run for each kind of
 * heading, the automatic table cells the server knows, the title parts, and the Jira fields
 * the template copied from an example bug.
 */
export async function startTemplatedBug(projectId: string, entryId: string, stepIndex: number | null, actual: string, templateId: string) {
  return wrap(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const { ctx, entry } = await bugContext(projectId, entryId, stepIndex, actual);
    const { layout } = await layoutOf(projectId, templateId);
    const fill: RunFill = {
      steps: sectionText("steps", ctx),
      expected: sectionText("expected", ctx),
      actual: sectionText("actual", ctx),
      env: sectionText("env", ctx),
      hasStep: ctx.steps.length > 0,
      failed: ctx.failedIndex !== null,
    };
    const run = entry.run;
    const client = layout.fields.length ? await jiraFor(projectId).catch(() => null) : null;
    const draft = client ? importedDraft({ from: layout.from, title: { tag: false, feature: false }, sections: [], fields: layout.fields }, entry, ctx, await client.fieldMeta().catch(() => null)) : null;
    return {
      fill,
      auto: { build: [run.build, ctx.fields?.find((f) => /csp/i.test(f.name))?.value].filter(Boolean).join(" · ") || run.release || "", env: run.environment, who: user.name ?? user.email },
      platform: tagOf(entry.title) || (ctx.titleTags?.[0] ?? "").toUpperCase() || clientIn(`${run.name} ${run.project.name}`),
      area: featureOf(entry.title),
      build: run.build || run.release || "",
      summary: defaultSummary({ ...ctx, titleTags: [] }),
      fields: draft?.fields ?? [],
    };
  });
}

const answerSchema = z.array(z.unknown()).max(40);

const templatedSchema = z.object({
  templateId: z.string().min(1).max(40),
  summary: z.string().trim().min(1, "Add a summary for the title.").max(200),
  platform: line(40),
  area: line(120),
  build: line(120),
  severity: severitySchema.default(DEFAULT_SEVERITY),
  stepIndex: z.number().int().min(0).nullable(),
  actual: z.string().max(10000).default(""),
  answers: answerSchema,
  attachmentIds: z.array(z.string()).max(20).default([]),
  fields: z.record(z.string().max(60), z.array(z.string().max(5000)).max(30)).default({}),
  stories: z.array(z.string().max(30)).max(10).default([]),
  regression: z.boolean().default(false),
  sentry: z.array(z.unknown()).max(20).default([]),
  fromDefectId: z.string().optional(),
  /** A bug from a bug bash: its saved layout is used, as it was when it was logged. */
  bashItemId: z.string().max(40).optional(),
  /** Lines that go under the headings, like where in the bash it was found. */
  notes: z.array(z.object({ name: z.string().max(120), text: z.string().max(10000) })).max(6).default([]),
  /** Found-in version: left out = the release picked for you, null or "" = leave it out. */
  foundIn: z.string().trim().max(255).nullable().optional(),
  /** Write a bug: false keeps it here even when Jira is connected ("Also file it in Jira" unticked). */
  jira: z.boolean().default(true),
});

/** Only the headings the template has, in its order, with what was filled in under each. */
function cleanAnswers(layout: BugLayout, raw: unknown[]): Answer[] {
  const given = parseAnswers(raw);
  return layout.sections
    .filter((s) => s.source !== "empty")
    .map((s) => {
      const a = given.find((x) => x.id === s.id);
      const base: Answer = { id: s.id, heading: s.heading, source: a?.source === "text" && (s.source === "steps" || s.source === "expected") ? "text" : s.source, text: a?.text ?? "" };
      if (s.source === "table") {
        const rows = (a?.rows ?? []).map((r) => s.columns.map((_, i) => r[i] ?? ""));
        return { ...base, text: "", columns: s.columns, rows, growing: s.growing };
      }
      if (s.source === "file") return { ...base, files: a?.files ?? [] };
      return base;
    });
}

/**
 * Report a bug with a bug template: to Jira when it's connected (the headings in the description,
 * tables as Jira tables, every file attached), otherwise saved here with the same headings.
 * The bug keeps the template's layout as it was, so later edits never change it.
 */
export async function fileTemplatedBug(projectId: string, entryId: string, input: z.input<typeof templatedSchema>) {
  return wrap(async () => {
    const { user, project } = await requireProjectAction(projectId, "run:execute");
    const data = templatedSchema.parse(input);
    const fromBash = data.bashItemId ? await db.bashItem.findFirst({ where: { id: data.bashItemId, bash: { run: { projectId } } }, select: { templateName: true, layout: true } }) : null;
    if (data.bashItemId && !fromBash?.layout) throw new UserError("That bug bash bug isn't here anymore.");
    const local = data.fromDefectId ? await db.defect.findFirst({ where: { id: data.fromDefectId, projectId } }) : null;
    if (data.fromDefectId && !local) throw new UserError("That bug isn't in this test cycle anymore.");
    if (local?.externalKey) throw new UserError(`That bug is already ${local.externalKey} in Jira.`);
    // Send to Jira for a written bug: the layout it was saved with.
    const saved = data.templateId === SAVED_ID && local?.layout ? { name: local.templateName, layout: parseLayout(local.layout) } : null;
    if (data.templateId === SAVED_ID && !saved) throw new UserError("That bug has no saved headings to send.");
    const { name, layout } = fromBash?.layout ? { name: fromBash.templateName, layout: parseLayout(fromBash.layout) } : (saved ?? (await layoutOf(projectId, data.templateId)));
    let answers = cleanAnswers(layout, data.answers);
    const sectionFileIds = answers.flatMap((a) => (a.files ?? []).map((f) => f.id));
    const ids = [...new Set([...data.attachmentIds, ...sectionFileIds])];
    const found = ids.length ? await db.attachment.findMany({ where: { id: { in: ids }, projectId } }) : [];
    const general = data.attachmentIds.flatMap((id) => found.filter((f) => f.id === id));
    // Files under a heading, named as stored (not as the browser said).
    answers = answers.map((a) => (a.files ? { ...a, files: a.files.flatMap((f) => found.filter((x) => x.id === f.id).map((x) => ({ id: x.id, fileName: x.fileName }))) } : a));
    const shots = general.filter((f) => /^(image|video)\//.test(f.contentType)).length;
    const gaps = missing(layout, answers, shots);
    if (gaps.length) throw new UserError(`Add ${listWords(gaps)} to report this bug.`);
    const allFiles = [...general, ...found.filter((f) => sectionFileIds.includes(f.id) && !general.some((g) => g.id === f.id))];
    answers = answers.map((a) => withFileNames(a, allFiles.map((f) => f.fileName)));
    const summary = layoutTitle(layout.title, { platform: data.platform, area: data.area, build: data.build, summary: data.summary });
    const notes = data.notes.filter((n) => n.text.trim());
    // A written bug (no run entry) is marked in its saved layout, for the "Not from a run" chip.
    // The OKO layout keeps its Jira fields' answers (Team, Client/SKUs, Oly Environment) for Send to Jira later.
    const kept = layout.oko ? { ...layout, fields: layout.fields.map((f) => ({ ...f, value: data.fields[f.id]?.length ? data.fields[f.id] : f.value })) } : layout;
    const keep = { templateName: name, layout: (entryId ? kept : { ...kept, written: true }) as unknown as Prisma.InputJsonValue, answers: answers as unknown as Prisma.InputJsonValue, description: [answersText(answers), ...notes.map((n) => `${n.name}\n${n.text}`)].filter(Boolean).join("\n\n").slice(0, 60000) };
    const client = data.jira || local ? await jiraFor(projectId) : null;
    if (!client) {
      if (local) throw new UserError("Jira isn't connected for this test cycle.");
      const { defectSeq } = await db.project.update({ where: { id: projectId }, data: { defectSeq: { increment: 1 } } });
      const release = data.foundIn === null || data.foundIn === "" ? "" : (data.foundIn ?? (await localRelease(projectId, entryId)));
      const defect = await db.defect.create({ data: { projectId, number: defectSeq, title: summary, severity: data.severity, createdById: user.id, createdBy: user.name ?? user.email, foundIn: release, ...keep } });
      if (allFiles.length) await db.attachment.updateMany({ where: { id: { in: allFiles.map((f) => f.id) }, projectId }, data: { defectId: defect.id } });
      return { defect: toLinked(defect), attachError: null as string | null, reporterNote: null as string | null, linkError: null as string | null };
    }
    if (data.regression) {
      const reg = await entryRegression(project, entryId);
      if (reg) {
        client.labels = [reg.label];
        client.leadLines = [reg.line];
      }
    }
    const sentryRefs = parseSentryRefs(data.sentry);
    if (sentryRefs.length) client.tailBlocks = sentryAdf(await sentryFrames(projectId, sentryRefs));
    const { ctx } = await bugContext(projectId, entryId, data.stepIndex, data.actual);
    const account = await jiraAccountOf(client, user);
    const tester = user.name ?? user.email;
    const foundIn = await applyFoundIn(client, entryId, projectId, data.foundIn);
    // Jira fields copied from an example bug, filled as an imported template fills them.
    const meta = layout.fields.length ? await client.fieldMeta().catch(() => null) : null;
    const fields: Record<string, { name: string; value: unknown }> = {};
    const extra: { name: string; text: string }[] = [];
    for (const f of layout.fields) {
      const value = (data.fields[f.id] ?? []).map((v) => v.trim()).filter(Boolean);
      if (!value.length) continue;
      const m = metaFor(meta, f);
      const known = m && (m.options.length ? value.every((v) => m.options.includes(v)) : !isPick(m));
      const jira = m && known ? jiraValue(m, m.schema.type === "array" ? value : value[0]) : undefined;
      if (m && jira !== undefined) fields[m.id] = { name: f.name, value: jira };
      else extra.push({ name: f.name, text: value.join(", ") });
    }
    const missingRequired = layout.fields.filter((f) => f.required && !(data.fields[f.id] ?? []).some((v) => v.trim()));
    if (missingRequired.length) throw new UserError(`Fill in ${listWords(missingRequired.map((f) => f.name))} for Jira.`);
    const valueOf = new Map(layout.fields.map((f) => [f.name, (data.fields[f.id] ?? []).join(", ")]));
    const trace = traceOf(ctx);
    let key: string, reporterSet: boolean;
    let attachError: string | null = null;
    let linkError: string | null = null;
    if (kept.oko) {
      // The OKO layout files exactly as the OKO form does: every answer into Jira's own field.
      const bug = draftToOko({ platform: data.platform, area: data.area, summary: data.summary, answers, fields: kept.fields });
      ({ key, reporterSet, attachError, linkError } = await fileTemplateBug(client, bug, data.severity, account, tester, allFiles, trace));
    } else {
      ({ key, reporterSet } = await client.createIssue({
        summary,
        description: (left) =>
          answersAdf(answers, {
            reportedBy: account && left.reporterSet ? null : tester,
            extra: [...notes, ...extra, ...left.dropped.filter((n) => valueOf.get(n)).map((n) => ({ name: n, text: valueOf.get(n)! }))],
            trace,
          }),
        severity: data.severity,
        reporterId: account?.accountId,
        fields,
      }));
      attachError = (await client.attachEach(key, allFiles.map((f) => ({ fileName: f.fileName, contentType: f.contentType, data: f.data })))).note;
    }
    const reporterNote =
      account && !reporterSet ? `Jira wouldn't let Flaw Patrol set you as the reporter of ${key}, so your name is in its description instead. Ask a Flaw Patrol admin to check Settings → Jira.` : null;
    const issue = await client.getIssue(key).catch(() => ({ key, summary, status: "", category: "new", url: `${client.creds.siteUrl}/browse/${key}`, severity: null, priority: "", type: "", parent: null, foundIn: null as string | null }));
    const mirrored = local
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
    // A written bug keeps the Found in that was typed, even when Jira's found-in version is off.
    const typedFoundIn = !entryId && data.foundIn ? data.foundIn : "";
    const defect = await db.defect.update({ where: { id: mirrored.id }, data: { ...keep, ...((foundIn || typedFoundIn) && { foundIn: issue.foundIn || foundIn || typedFoundIn }) } });
    if (allFiles.length) await db.attachment.updateMany({ where: { id: { in: allFiles.map((f) => f.id) }, projectId }, data: { defectId: defect.id } });
    if (local) revalidatePath(`/p/${project.key}`, "layout");
    if (data.stories.length) {
      const own = await db.runEntry.findFirst({ where: { id: entryId }, select: { testCase: { select: { jiraStories: true } } } });
      const failed: string[] = [];
      // A bash bug relates to what its area was testing; a run's bug to its case's stories.
      for (const story of data.stories.filter((k) => fromBash || own?.testCase.jiraStories.includes(k))) await client.relate(key, story).catch(() => failed.push(story));
      if (failed.length) linkError = `${key} was created, but Jira wouldn't link it to ${failed.join(", ")}.`;
    }
    await alertBugFiled(project, { key, url: issue.url, title: issue.summary || summary, severity: data.severity }, { tester, caseKey: ctx.caseKey, step: data.stepIndex }).catch(() => {});
    return { defect: toLinked(defect), attachError, reporterNote, linkError };
  });
}

const rowSchema = z.object({
  defectId: z.string().min(1).max(40),
  answerId: z.string().min(1).max(40),
  cells: z.array(z.string().max(2000)).max(12),
  attachmentIds: z.array(z.string()).max(10).default([]),
});

/**
 * I saw it again: one more row in a bug's growing table. The automatic cells come
 * filled in from the person's run and browser; with Jira connected the Jira bug's table updates too.
 */
export async function addBugRow(projectId: string, input: z.input<typeof rowSchema>) {
  return wrap(async () => {
    const { project } = await requireProjectAction(projectId, "run:execute");
    const data = rowSchema.parse(input);
    const defect = await db.defect.findFirst({ where: { id: data.defectId, projectId } });
    if (!defect) throw new UserError("That bug isn't in this test cycle anymore.");
    const answers = parseAnswers(defect.answers);
    const at = answers.findIndex((a) => a.id === data.answerId && a.rows && a.columns && a.growing);
    if (at < 0) throw new UserError("This bug has no table to add a row to.");
    const a = answers[at];
    const files = data.attachmentIds.length ? await db.attachment.findMany({ where: { id: { in: data.attachmentIds }, projectId } }) : [];
    const row = a.columns!.map((c, i) => (c.fill === "files" ? files.map((f) => f.fileName).join("\n") || "None" : (data.cells[i] ?? "").trim()));
    if (!row.some((c) => c && c !== "None")) throw new UserError("Fill in at least one cell.");
    answers[at] = { ...a, rows: [...a.rows!, row].slice(-200) };
    let jiraError: string | null = null;
    if (defect.externalKey) {
      const client = await jiraFor(projectId);
      if (client) {
        try {
          const sent = files.length ? await client.attachEach(defect.externalKey, files.map((f) => ({ fileName: f.fileName, contentType: f.contentType, data: f.data }))) : null;
          if (sent?.note) jiraError = sent.note.replace(`${defect.externalKey} was created. `, "The row is saved. ");
          // Only the table changes: the rest of the description stays as Jira has it, edits made there included.
          const now = await client.getDescription(defect.externalKey);
          await client.setDescription(defect.externalKey, addRowToAdf(now, answers[at], row), { asIs: true });
        } catch (e) {
          jiraError = `The row is saved here, but Jira didn't take it: ${e instanceof Error ? e.message : "it couldn't be reached"}.`;
        }
      }
    }
    await db.defect.update({ where: { id: defect.id }, data: { answers: answers as unknown as Prisma.InputJsonValue, description: answersText(answers) } });
    if (files.length) await db.attachment.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { defectId: defect.id } });
    revalidatePath(`/p/${project.key}`, "layout");
    revalidatePath("/g", "layout");
    return { rows: answers[at].rows!, jiraError };
  });
}

/** The automatic cells a new row on a bug starts with, for the person adding it. */
export async function bugRowStart(projectId: string) {
  return wrap(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    // Their latest run in this test cycle gives the build and environment.
    const run = await db.testRun.findFirst({ where: { projectId, entries: { some: { results: { some: { testerId: user.id } } } } }, orderBy: { createdAt: "desc" }, select: { name: true, build: true, release: true, environment: true } });
    return { who: user.name ?? user.email, build: run?.build || run?.release || "", env: run?.environment ?? "", runName: run?.name ?? "" };
  });
}
