"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { canOpen, open, seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { parseFieldValues } from "@/lib/run-fields";
import { requireProjectAction } from "@/lib/session";
import { SentryClient, SentryError, sentryBase, type SentryRef } from "@/lib/sentry";
import { attempt, UserError } from "./result";

// Sentry for testers. Read-only: Flaw Patrol never writes to Sentry.

/** The Sentry connection a test cycle uses: its own, else its umbrella's. */
async function configFor(projectId: string) {
  const own = await db.sentryConfig.findUnique({ where: { projectId } });
  if (own) return own;
  const p = await db.project.findUnique({ where: { id: projectId }, select: { group: { select: { hubProjectId: true } } } });
  const hub = p?.group?.hubProjectId;
  return hub && hub !== projectId ? db.sentryConfig.findUnique({ where: { projectId: hub } }) : null;
}

type ProjectRef = { id: string; slug: string };
const projectsOf = (v: unknown): ProjectRef[] =>
  Array.isArray(v) ? v.filter((p): p is ProjectRef => !!p && typeof p.id === "string" && typeof p.slug === "string") : [];

async function clientFor(projectId: string) {
  const cfg = await configFor(projectId);
  if (!cfg || !canOpen(cfg.tokenEncrypted)) return null;
  return { cfg, client: new SentryClient(cfg.baseUrl, open(cfg.tokenEncrypted), cfg.org), projects: projectsOf(cfg.projects) };
}

const wrap = <T extends object>(fn: () => Promise<T>) =>
  attempt(async () => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SentryError) throw new UserError(e.message);
      throw e;
    }
  });

/** Step 1 of Connect to Sentry: check the token and list the organizations it can see. */
export async function checkSentry(projectId: string, input: { baseUrl: string; token: string }) {
  return wrap(async () => {
    await requireProjectAction(projectId, "jira:manage");
    let token = input.token.trim();
    // Reconnecting can keep the saved token.
    if (!token) {
      const saved = await db.sentryConfig.findUnique({ where: { projectId } });
      if (!saved || !canOpen(saved.tokenEncrypted)) throw new UserError("Paste a Sentry token.");
      token = open(saved.tokenEncrypted);
    }
    const c = new SentryClient(sentryBase(input.baseUrl), token);
    const orgs = await c.organizations();
    if (!orgs.length) throw new UserError("That token can't see any organization. Give it Organization read.");
    return { orgs, as: await c.whoAmI() };
  });
}

/** Step 2: the organization's projects and their environments. */
export async function sentryProjects(projectId: string, input: { baseUrl: string; token: string; org: string }) {
  return wrap(async () => {
    await requireProjectAction(projectId, "jira:manage");
    let token = input.token.trim();
    if (!token) {
      const saved = await db.sentryConfig.findUnique({ where: { projectId } });
      if (!saved || !canOpen(saved.tokenEncrypted)) throw new UserError("Paste a Sentry token.");
      token = open(saved.tokenEncrypted);
    }
    const c = new SentryClient(sentryBase(input.baseUrl), token, input.org);
    const projects = await c.projects();
    const envs = new Set<string>();
    for (const p of projects.slice(0, 8)) for (const e of await c.environments(p.slug)) envs.add(e);
    return { projects, environments: [...envs].sort() };
  });
}

const saveSchema = z.object({
  baseUrl: z.string().trim().max(200),
  token: z.string().trim().max(500),
  org: z.string().trim().min(1, "Pick an organization").max(100),
  as: z.string().max(200).default(""),
  projects: z.array(z.object({ id: z.string(), slug: z.string() })).min(1, "Pick at least one Sentry project").max(20),
  environment: z.string().max(100).default(""),
  buildField: z.string().max(60).default("build"),
  onlyTester: z.boolean().default(true),
});

/** Step 3: save. Anyone who can change Jira here can connect Sentry. */
export async function saveSentry(projectId: string, input: z.input<typeof saveSchema>) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const d = saveSchema.parse(input);
    const saved = await db.sentryConfig.findUnique({ where: { projectId } });
    if (!d.token && !saved) throw new UserError("Paste a Sentry token.");
    const tokenEncrypted = d.token ? seal(d.token) : saved!.tokenEncrypted;
    const data = { baseUrl: sentryBase(d.baseUrl), org: d.org, tokenEncrypted, connectedAs: d.as, projects: d.projects, environment: d.environment, buildField: d.buildField, onlyTester: d.onlyTester };
    await db.sentryConfig.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await logActivity({ actor: user, kind: "settings", action: saved ? "Changed the Sentry connection" : "Connected Sentry", project, detail: `${d.org} · ${d.projects.map((p) => p.slug).join(", ")}` });
    revalidatePath("/", "layout");
    return {};
  });
}

export async function disconnectSentry(projectId: string) {
  return wrap(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    await db.sentryConfig.deleteMany({ where: { projectId } });
    await logActivity({ actor: user, kind: "settings", action: "Disconnected Sentry", project });
    revalidatePath("/", "layout");
    return {};
  });
}

/** The run's build, by the field Settings → Sentry says holds it. */
function buildOf(run: { build: string; fields: unknown }, field: string) {
  if (!field) return "";
  if (field === "build") return run.build;
  return parseFieldValues(run.fields).find((f) => f.id === field)?.value ?? "";
}

/** Same as the run field shape the run stores: [{ id, name, value }]. */
function release(client: SentryClient, cfg: { buildField: string }, run: { build: string; fields: unknown }, ids: string[]) {
  const build = buildOf(run, cfg.buildField).trim();
  return build ? client.releaseFor(build, ids) : Promise.resolve(null);
}

/**
 * Errors Sentry caught while someone was on a step: from when they opened it until now,
 * two minutes either side, in the run's build. Only theirs when Settings says so and
 * Sentry knows their email; everyone's otherwise.
 */
export async function sentryForStep(projectId: string, entryId: string, input: { openedAt: string; stepIndex: number | null }) {
  return wrap(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const s = await clientFor(projectId);
    if (!s) return { connected: false as const, errors: [] as SentryRef[], searchUrl: "" };
    const entry = await db.runEntry.findFirst({ where: { id: entryId, run: { projectId } }, include: { run: true } });
    if (!entry) throw new UserError("This case is no longer in the run.");
    const ids = s.projects.map((p) => p.id);
    const opened = new Date(input.openedAt);
    const start = new Date((isNaN(opened.getTime()) ? Date.now() - 10 * 60_000 : opened.getTime()) - 2 * 60_000);
    const end = new Date(Date.now() + 2 * 60_000);
    const rel = await release(s.client, s.cfg, entry.run, ids).catch(() => null);
    const base = [rel ? `release:"${rel}"` : "", "is:unresolved"].filter(Boolean).join(" ");
    const email = user.jiraEmail || user.email;
    let issues = s.cfg.onlyTester ? await s.client.issues({ projectIds: ids, start, end, environment: s.cfg.environment, query: `${base} user.email:${email}`, limit: 10 }).catch(() => []) : [];
    // Falls back to everyone's errors when the app doesn't send user emails to Sentry.
    const onlyYours = issues.length > 0;
    if (!onlyYours) issues = await s.client.issues({ projectIds: ids, start, end, environment: s.cfg.environment, query: base, limit: 10 });
    const errors: SentryRef[] = [];
    for (const i of issues.slice(0, 8))
      errors.push({
        id: i.id,
        shortId: i.shortId,
        title: i.title,
        url: i.url,
        project: i.project,
        count: i.count,
        firstSeen: i.firstSeen,
        fresh: new Date(i.firstSeen) >= entry.run.createdAt,
        frames: await s.client.topFrames(i.id).catch(() => []),
        release: rel ?? "",
        environment: s.cfg.environment,
        stepIndex: input.stepIndex,
      });
    return { connected: true as const, errors, onlyYours, release: rel, searchUrl: s.client.searchUrl(base, ids) };
  });
}

/** "Sentry error…" in the bug box's + Add menu: look one up by its ID (APP-IOS-3F2), link or words. */
export async function searchSentry(projectId: string, entryId: string, query: string) {
  return wrap(async () => {
    await requireProjectAction(projectId, "run:execute");
    const s = await clientFor(projectId);
    if (!s) throw new UserError("Sentry isn't connected. An admin can connect it in Settings.");
    const entry = await db.runEntry.findFirst({ where: { id: entryId, run: { projectId } }, include: { run: true } });
    const ids = s.projects.map((p) => p.id);
    const q = query.trim();
    const fromLink = q.match(/issues\/(\d+)/)?.[1];
    const term = fromLink ? `issue.id:${fromLink}` : /^[A-Z0-9]+-[A-Z0-9]+$/i.test(q) ? `issue:${q.toUpperCase()}` : q;
    const issues = await s.client.issues({ projectIds: ids, start: new Date(Date.now() - 14 * 86_400_000), end: new Date(), environment: s.cfg.environment, query: term, limit: 8 });
    const rel = entry ? await release(s.client, s.cfg, entry.run, ids).catch(() => null) : null;
    return {
      errors: issues.map(
        (i): SentryRef => ({ id: i.id, shortId: i.shortId, title: i.title, url: i.url, project: i.project, count: i.count, firstSeen: i.firstSeen, fresh: !!entry && new Date(i.firstSeen) >= entry.run.createdAt, frames: [], release: rel ?? "", environment: s.cfg.environment }),
      ),
    };
  });
}

/** Fill in stack frames for errors picked in the bug box before they go to Jira. */
export async function sentryFrames(projectId: string, refs: SentryRef[]) {
  await requireProjectAction(projectId, "run:execute");
  const s = await clientFor(projectId);
  if (!s) return refs;
  return Promise.all(refs.map(async (r) => (r.frames.length ? r : { ...r, frames: await s.client.topFrames(r.id).catch(() => []) })));
}

/**
 * The Sentry card on a run page and Reports → RC status: crash-free sessions and new
 * errors for the run's build, and errors found during these runs (and how many are in bugs).
 */
export async function sentryBuildStats(projectId: string, runIds: string[]) {
  return wrap(async () => {
    await requireProjectAction(projectId, "run:execute");
    const s = await clientFor(projectId);
    if (!s) return { stats: null };
    const runs = await db.testRun.findMany({ where: { id: { in: runIds } }, select: { build: true, fields: true } });
    const ids = s.projects.map((p) => p.id);
    const rel = runs[0] ? await release(s.client, s.cfg, runs[0], ids).catch(() => null) : null;
    const results = await db.testResult.findMany({ where: { runId: { in: runIds }, sentry: { not: undefined } }, select: { sentry: true, defects: { select: { defectId: true } } } });
    const found = new Map<string, boolean>();
    for (const r of results)
      for (const ref of (Array.isArray(r.sentry) ? r.sentry : []) as { id?: string }[]) if (ref?.id) found.set(ref.id, (found.get(ref.id) ?? false) || r.defects.length > 0);
    const [crashFree, fresh] = rel ? await Promise.all([s.client.crashFree(rel, ids), s.client.newInRelease(rel, ids)]) : [null, null];
    return {
      stats: {
      release: rel,
      build: runs[0] ? buildOf(runs[0], s.cfg.buildField) : "",
      crashFree,
      fresh,
      found: found.size,
      inBugs: [...found.values()].filter(Boolean).length,
      newUrl: rel ? s.client.searchUrl(`first-release:"${rel}"`, ids) : null,
      releaseUrl: rel ? s.client.searchUrl(`release:"${rel}"`, ids) : null,
      at: new Date().toISOString(),
      },
    };
  });
}
