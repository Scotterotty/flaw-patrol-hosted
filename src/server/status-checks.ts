import "server-only";

import { LIVE_BASH } from "@/lib/bash-cases";
import { canOpen, open } from "@/lib/crypto";
import { db } from "@/lib/db";
import { GitHubClient } from "@/lib/github";
import { runTitle } from "@/lib/run-label";
import { parseSentryRefs, SentryClient } from "@/lib/sentry";
import { buildOf } from "@/lib/sentry-build";
import { cantReach, ciCard, githubCard, otherBuildsQuery, SENTRY_ROWS, sentryCard, teamcityCard, type SentryBuildIn, type StatusCard, type StatusSource } from "@/lib/status-cards";
import { TeamCityClient, TeamCityError } from "@/lib/teamcity";
import { parseBuildTypes } from "@/lib/teamcity-config";
import type { Umbrella } from "@/lib/umbrella";

// Status (ver_228): asks each tool how its newest builds went. Every card is checked on its own
// (the page loads them one by one), and an answer is kept for a minute so a busy page doesn't
// keep asking GitHub, TeamCity or Sentry. Only reads: nothing here changes anything in a tool.

/** How long an answer is reused. Refresh asks again once it's older than REFRESH_MS. */
const KEEP_MS = 60_000;
const REFRESH_MS = 10_000;

type Kept = { card: StatusCard; at: number };
type Store = {
  kept: Map<string, Kept>;
  asking: Map<string, Promise<StatusCard>>;
  /** The newest state of each card, per umbrella: the red count in the left menu reads this. */
  states: Map<string, Map<string, StatusCard["state"]>>;
};
// On globalThis: Next.js can load this file once per route, and the left menu (any page) must see
// what the Status page and Overview found.
const g = globalThis as { __fpStatus?: Store };
const store = (g.__fpStatus ??= { kept: new Map(), asking: new Map(), states: new Map() });
const { kept, asking, states } = store;

/** How many cards need a look, from the newest answers (no tool is asked). Null when Status hasn't been checked yet. */
export function knownRedCount(groupId: string): number | null {
  const s = states.get(groupId);
  if (!s) return null;
  return [...s.values()].filter((v) => v === "bad").length;
}

/** The umbrella's cards, without asking any tool: what's connected, by name. */
export async function statusSources(u: Umbrella): Promise<StatusSource[]> {
  const autoOn = u.tools.includes("auto");
  const [repos, ciTokens, teamcity, sentry] = await Promise.all([
    autoOn ? db.gitHubRepo.findMany({ where: { groupId: u.group.id }, orderBy: { createdAt: "asc" }, select: { id: true, fullName: true, workflowName: true } }) : [],
    autoOn ? db.ciToken.count({ where: { groupId: u.group.id } }) : 0,
    db.teamCityConfig.findUnique({ where: { groupId: u.group.id }, select: { buildTypes: true } }),
    db.sentryConfig.findUnique({ where: { projectId: u.hub.id }, select: { projectId: true } }),
  ]);
  const out: StatusSource[] = [];
  for (const r of repos) out.push({ key: `gh:${r.id}`, tool: "GitHub", title: `GitHub · ${r.fullName.split("/")[1] ?? r.fullName}${r.workflowName ? ` ${r.workflowName}` : ""}` });
  if (teamcity) {
    const types = parseBuildTypes(teamcity.buildTypes);
    if (!types.length) out.push({ key: "tc:", tool: "TeamCity", title: "TeamCity" });
    for (const t of types) out.push({ key: `tc:${t.id}`, tool: "TeamCity", title: `TeamCity · ${t.name}` });
  }
  if (sentry) out.push({ key: "sentry", tool: "Sentry", title: "Sentry" });
  if (ciTokens) out.push({ key: "ci", tool: "CI uploads", title: "CI uploads" });
  // Forget cards that went away (a repo removed, a build unpicked), so the menu count stays right.
  const s = states.get(u.group.id);
  if (s) for (const k of s.keys()) if (!out.some((o) => o.key === k)) s.delete(k);
  return out;
}

/** One card: kept for a minute unless `fresh` (Refresh) and older than ten seconds. */
export async function checkCard(u: Umbrella, src: StatusSource, fresh = false): Promise<StatusCard> {
  // Sentry and CI read runs, and people see only the test cycles they're on.
  const scope = src.key === "sentry" || src.key === "ci" ? `|${visibleIds(u).join(",")}` : "";
  const id = `${u.group.id}|${src.key}${scope}`;
  const hit = kept.get(id);
  const age = hit ? Date.now() - hit.at : Infinity;
  let card: StatusCard;
  if (hit && age < (fresh ? REFRESH_MS : KEEP_MS)) card = hit.card;
  else {
    let p = asking.get(id);
    if (!p) {
      p = ask(u, src).finally(() => asking.delete(id));
      asking.set(id, p);
    }
    card = await p;
    kept.set(id, { card, at: Date.now() });
  }
  const s = states.get(u.group.id) ?? new Map();
  s.set(src.key, card.state);
  states.set(u.group.id, s);
  return card;
}

const visibleIds = (u: Umbrella) => [u.hub.id, ...u.projects.map((p) => p.id)].sort();

async function ask(u: Umbrella, src: StatusSource): Promise<StatusCard> {
  const now = new Date().toISOString();
  try {
    if (src.key.startsWith("gh:")) return await askGitHub(src, src.key.slice(3), now);
    if (src.key.startsWith("tc:")) return await askTeamCity(u, src, src.key.slice(3), now);
    if (src.key === "sentry") return await askSentry(u, src, now);
    if (src.key === "ci") return await askCi(u, src, now);
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : "Something went wrong asking it.";
    return cantReach(src, message, fixFor(src), now);
  }
  return cantReach(src, "This card isn't connected any more. Refresh the page.", fixFor(src), now);
}

function fixFor(src: StatusSource) {
  return src.tool === "GitHub" ? "github" : src.tool === "TeamCity" ? "teamcity" : src.tool === "Sentry" ? "sentry" : "ci-uploads";
}

const TOKEN_HELP = "An Admin can reconnect it in Settings";

async function askGitHub(src: StatusSource, repoId: string, now: string): Promise<StatusCard> {
  const repo = await db.gitHubRepo.findUnique({ where: { id: repoId } });
  if (!repo) return cantReach(src, "This repo isn't connected any more", "github", now);
  if (!repo.workflowId) return cantReach(src, "Setup isn't finished: an Admin picks which workflow to watch in Settings → GitHub", "github", now);
  if (!canOpen(repo.tokenEncrypted)) return cantReach(src, `The saved GitHub token can't be read on this server. ${TOKEN_HELP}`, "github", now);
  const client = new GitHubClient(repo.fullName, open(repo.tokenEncrypted));
  let runs;
  try {
    runs = await client.runs(repo.workflowId, 6);
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    // A turned-down token says who can fix it, in the same words as the other tools.
    if (/accept the access token|can't read Actions/i.test(m)) return cantReach(src, `GitHub turned down the saved token. ${TOKEN_HELP}`, "github", now);
    throw e;
  }
  const newest = runs.find((r) => r.status === "completed");
  // Which step broke, in GitHub's own words, only for a failed run.
  const steps = newest && newest.conclusion !== "success" ? await client.steps(newest.id, true).catch(() => null) : null;
  return { ...githubCard(src, runs, steps?.sentence ?? null, now), more: { href: `/g/${repo.groupId}/status/github`, label: "Test health" } };
}

async function askTeamCity(u: Umbrella, src: StatusSource, buildTypeId: string, now: string): Promise<StatusCard> {
  const cfg = await db.teamCityConfig.findUnique({ where: { groupId: u.group.id } });
  if (!cfg) return cantReach(src, "TeamCity isn't connected any more", "teamcity", now);
  if (!buildTypeId) return cantReach(src, "Connected, but no builds are picked to watch. An Admin picks them in Settings → TeamCity", "teamcity", now);
  if (!canOpen(cfg.tokenEncrypted)) return cantReach(src, `The saved TeamCity token can't be read on this server. ${TOKEN_HELP}`, "teamcity", now);
  try {
    return teamcityCard(src, await new TeamCityClient(cfg.baseUrl, open(cfg.tokenEncrypted)).builds(buildTypeId, 5), now);
  } catch (e) {
    if (e instanceof TeamCityError && e.token) return cantReach(src, `TeamCity turned down the saved token. ${TOKEN_HELP}`, "teamcity", now);
    throw e;
  }
}

/** "Being tested": a run with results in the last 7 days, or a live bug bash (ver_258). */
const TESTED_DAYS = 7;

async function askSentry(u: Umbrella, src: StatusSource, now: string): Promise<StatusCard> {
  const cfg = await db.sentryConfig.findUnique({ where: { projectId: u.hub.id } });
  if (!cfg) return cantReach(src, "Sentry isn't connected any more", "sentry", now);
  if (!canOpen(cfg.tokenEncrypted)) return cantReach(src, `The saved Sentry token can't be read on this server. ${TOKEN_HELP}`, "sentry", now);
  const projects = (Array.isArray(cfg.projects) ? cfg.projects : []) as { id?: string }[];
  const ids = projects.map((p) => p?.id).filter((x): x is string => typeof x === "string");
  const client = new SentryClient(cfg.baseUrl, open(cfg.tokenEncrypted), cfg.org);
  // Proves the token still works before saying anything about a build.
  await client.projects();

  // The builds being tested: hand-run runs with results in the last 7 days, or in a live bug bash.
  const at = new Date(now);
  const since = new Date(at.getTime() - TESTED_DAYS * 86_400_000);
  const runs = await db.testRun.findMany({
    where: { projectId: { in: visibleIds(u) }, automated: false, OR: [{ results: { some: { createdAt: { gte: since } } } }, { bugBash: { is: LIVE_BASH(at) } }] },
    select: {
      id: true,
      name: true,
      number: true,
      build: true,
      fields: true,
      release: true,
      createdAt: true,
      project: { select: { key: true, platform: true, rcName: true } },
      bugBash: { select: { id: true, startsAt: true, endedAt: true, wrappedAt: true, endsAt: true } },
      results: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
    take: 200,
  });
  const liveBash = (r: (typeof runs)[number]) => !!r.bugBash && !r.bugBash.endedAt && !r.bugBash.wrappedAt && r.bugBash.startsAt <= at && r.bugBash.endsAt > at;
  // Newest activity first: the newest result, or when a live bash started.
  const last = (r: (typeof runs)[number]) => Math.max(r.results[0]?.createdAt.getTime() ?? 0, liveBash(r) ? (r.bugBash?.startsAt.getTime() ?? 0) : 0);
  runs.sort((a, b) => last(b) - last(a));

  const builds = new Map<string, { platform: string; tags: Set<string>; runIds: string[] }>();
  const noBuild: typeof runs = [];
  for (const r of runs) {
    const build = buildOf(r, cfg.buildField).trim();
    if (!build) {
      noBuild.push(r);
      continue;
    }
    const b = builds.get(build) ?? { platform: r.project.platform, tags: new Set<string>(), runIds: [] };
    const rc = r.release.trim() || r.project.rcName.trim();
    if (rc && !r.bugBash) b.tags.add(rc);
    if (liveBash(r)) b.tags.add("Bug bash");
    b.runIds.push(r.id);
    builds.set(build, b);
  }

  // Errors already in a bug: the Sentry errors saved on failed steps of results that have a bug.
  const filed = builds.size
    ? await db.testResult.findMany({ where: { runId: { in: [...builds.values()].flatMap((b) => b.runIds) }, defects: { some: {} } }, select: { runId: true, sentry: true } })
    : [];
  const filedIn = (runIds: string[]) => filed.filter((f) => runIds.includes(f.runId)).flatMap((f) => parseSentryRefs(f.sentry).map((x) => x.id));

  // Up to three builds get Sentry's answer; the rest are only counted.
  const list = [...builds.entries()];
  const shown = await Promise.all(
    list.slice(0, SENTRY_ROWS).map(async ([build, b]): Promise<SentryBuildIn> => {
      const rel = await client.releaseFor(build, ids).catch(() => null);
      const [crashFree, freshIds] = rel ? await Promise.all([client.crashFree(rel, ids), client.newIssueIds(rel, ids)]) : [null, null];
      return {
        build,
        platform: b.platform,
        tags: [...b.tags],
        sentryRelease: rel,
        freshIds,
        inBugIds: filedIn(b.runIds),
        crashFree,
        newUrl: rel ? client.searchUrl(`first-release:"${rel}"`, ids) : null,
        releaseUrl: rel ? client.searchUrl(`release:"${rel}"`, ids) : null,
      };
    }),
  );
  const rest = list.slice(SENTRY_ROWS).map(([build, b]): SentryBuildIn => ({ build, platform: b.platform, tags: [...b.tags], sentryRelease: null, freshIds: null, inBugIds: [], crashFree: null, newUrl: null, releaseUrl: null }));

  // Everything else in the last day. A Sentry server that can't answer these searches hides the row.
  const tested = shown.map((b) => b.sentryRelease).filter((x): x is string => !!x);
  const otherQ = otherBuildsQuery(tested);
  const [other, none] = await Promise.all([
    client.countIssues(otherQ, ids).then((count) => ({ count, url: client.searchUrl(otherQ, ids, "24h") }), () => null),
    client.countIssues("!has:release", ids).then((count) => ({ count, url: client.searchUrl("!has:release", ids, "24h") }), () => null),
  ]);

  const m = noBuild[0];
  const missing = m
    ? { name: [m.project.platform, m.bugBash ? "bug bash" : m.release.trim() || m.project.rcName.trim(), "run"].filter(Boolean).join(" "), href: `/p/${m.project.key}/runs/${m.number}`, others: noBuild.length - 1 }
    : null;
  return sentryCard(src, { builds: [...shown, ...rest], other, none, missing }, now);
}

async function askCi(u: Umbrella, src: StatusSource, now: string): Promise<StatusCard> {
  // Runs a pipeline sent with a CI upload token are automated and made by "CI (token name)".
  const runs = await db.testRun.findMany({
    where: { projectId: { in: visibleIds(u) }, automated: true, githubRepoId: null, createdBy: { startsWith: "CI (" } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, name: true, build: true, number: true, createdAt: true, project: { select: { key: true } }, _count: { select: { entries: true } } },
  });
  const failed = runs.length
    ? await db.runEntry.groupBy({ by: ["runId"], where: { runId: { in: runs.map((r) => r.id) }, status: "FAILED" }, _count: { _all: true } })
    : [];
  const failedIn = new Map(failed.map((f) => [f.runId, f._count._all]));
  return ciCard(
    src,
    runs.map((r) => ({
      title: runTitle(r),
      build: r.build,
      at: r.createdAt.toISOString(),
      href: `/p/${r.project.key}/runs/${r.number}`,
      tests: r._count.entries,
      failed: failedIn.get(r.id) ?? 0,
    })),
    now,
  );
}
