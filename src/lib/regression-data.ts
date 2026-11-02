import "server-only";
import type { Prisma, ResultStatus } from "@prisma/client";
import { db } from "./db";
import { flakyCases } from "./flaky";
import { againstLabel, comparisonFor, historyMarks, isRegression, lastRcOf, parseRegressionSettings, VERDICTS, type PastResult, type RegressionSettings } from "./regression";

type Cycle = { id: string; groupId: string | null; platform: string };

/** Regression settings for a test cycle: its umbrella's, else the defaults. */
export async function regressionSettingsFor(project: { id: string; groupId: string | null }): Promise<RegressionSettings> {
  const g = await db.projectGroup.findFirst({
    where: { OR: [{ hubProjectId: project.id }, ...(project.groupId ? [{ id: project.groupId, hubProjectId: { not: null } }] : [])] },
    select: { regression: true },
  });
  return parseRegressionSettings(g?.regression);
}

/** Runs on the same platform: in the umbrella when the test cycle has a platform, else in the test cycle itself. */
export function samePlatform(c: Cycle): Prisma.TestRunWhereInput {
  return c.platform && c.groupId ? { project: { groupId: c.groupId, platform: { equals: c.platform, mode: "insensitive" } } } : { projectId: c.id };
}

const stepStatuses = (json: unknown): ResultStatus[] => (Array.isArray(json) ? json.map((s) => (s as { status?: ResultStatus }).status ?? "UNTESTED") : []);

/** Every verdict for these cases on the cycle's platform from runs started before `before` (other than `notRunId`), newest first. */
export async function pastResults(cases: string[], cycle: Cycle, before: Date, notRunId?: string) {
  if (!cases.length) return new Map<string, PastResult[]>();
  const rows = await db.testResult.findMany({
    where: { caseId: { in: cases }, status: { in: VERDICTS }, ...(notRunId && { runId: { not: notRunId } }), run: { ...samePlatform(cycle), createdAt: { lt: before } } },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      caseId: true,
      status: true,
      createdAt: true,
      entryId: true,
      caseVersion: true,
      testerName: true,
      stepResults: true,
      run: { select: { number: true, name: true, release: true, build: true, project: { select: { key: true, platform: true } } } },
    },
  });
  const out = new Map<string, PastResult[]>();
  for (const r of rows) {
    const list = out.get(r.caseId) ?? [];
    list.push({
      id: r.id,
      status: r.status,
      at: r.createdAt,
      release: r.run.release,
      build: r.run.build,
      runNumber: r.run.number,
      runName: r.run.name,
      projectKey: r.run.project.key,
      platform: r.run.project.platform,
      entryId: r.entryId,
      caseVersion: r.caseVersion,
      tester: r.testerName,
      stepStatuses: stepStatuses(r.stepResults),
    });
    out.set(r.caseId, list);
  }
  return out;
}

/** The earlier releases on the platform, newest first, for the "Compared with" picker. */
export async function earlierReleases(cycle: Cycle, release: string, before: Date) {
  const runs = await db.testRun.findMany({ where: { ...samePlatform(cycle), release: { not: "" }, createdAt: { lt: before } }, select: { release: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 200 });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of runs) {
    const k = r.release.trim().toLowerCase();
    if (k === release.trim().toLowerCase() || seen.has(k)) continue;
    seen.add(k);
    out.push(r.release.trim());
  }
  return out;
}

export type RunRegressions = {
  settings: RegressionSettings;
  /** What each case is compared with (whether or not it's flagged), by run entry. */
  against: Map<string, PastResult>;
  /** Flagged entries. */
  flagged: Set<string>;
  /** "Web RC 21": what the run is compared with, if anything. */
  comparedWith: PastResult | null;
  /** Earlier RCs to pick from instead. */
  choices: string[];
  only: string | null;
};

/** The Regression flag for every case in a run. `only` compares with one earlier release picked by hand. */
export async function runRegressions(
  run: { id: string; release: string; createdAt: Date; entries: { id: string; caseId: string; status: ResultStatus; regressionOff: boolean }[] },
  cycle: Cycle,
  only?: string | null,
): Promise<RunRegressions> {
  const settings = await regressionSettingsFor(cycle);
  const empty: RunRegressions = { settings, against: new Map(), flagged: new Set(), comparedWith: null, choices: [], only: null };
  if (!settings.on || !run.entries.length) return empty;
  const cases = [...new Set(run.entries.map((e) => e.caseId))];
  const [past, flaky, choices] = await Promise.all([pastResults(cases, cycle, run.createdAt, run.id), flakyCases({ caseIds: cases }), earlierReleases(cycle, run.release, run.createdAt)]);
  const pick = only && choices.some((c) => c.toLowerCase() === only.toLowerCase()) ? only : null;
  const lastRc = choices[0] ?? lastRcOf([...past.values()].flat(), run.release);
  const against = new Map<string, PastResult>();
  const flagged = new Set<string>();
  for (const e of run.entries) {
    const p = comparisonFor(past.get(e.caseId) ?? [], run.release, settings.compare, { lastRc, only: pick ?? undefined });
    if (!p) continue;
    against.set(e.id, p);
    if (isRegression(e.status, p, { flaky: flaky.has(e.caseId), off: e.regressionOff, on: settings.on })) flagged.add(e.id);
  }
  // The RC most cases are compared with names the run's comparison.
  const tally = new Map<string, { n: number; p: PastResult }>();
  for (const p of against.values()) {
    const k = `${p.release}|${p.platform}`;
    const t = tally.get(k) ?? { n: 0, p };
    t.n++;
    tally.set(k, t);
  }
  const comparedWith = [...tally.values()].sort((a, b) => b.n - a.n)[0]?.p ?? null;
  return { settings, against, flagged, comparedWith, choices, only: pick };
}

/** One case in a run compared with its earlier release, for the runner and the bug form. Null when the flag is off or there's nothing to compare. */
export async function entryComparison(project: { id: string; groupId: string | null; platform: string }, entryId: string) {
  const settings = await regressionSettingsFor(project);
  if (!settings.on) return null;
  const entry = await db.runEntry.findFirst({
    where: { id: entryId, run: { projectId: project.id } },
    select: { caseId: true, regressionOff: true, regressionOffBy: true, run: { select: { id: true, release: true, build: true, name: true, createdAt: true } } },
  });
  if (!entry) return null;
  const [past, flaky, choices] = await Promise.all([
    pastResults([entry.caseId], project, entry.run.createdAt, entry.run.id),
    flakyCases({ caseIds: [entry.caseId] }),
    earlierReleases(project, entry.run.release, entry.run.createdAt),
  ]);
  const against = comparisonFor(past.get(entry.caseId) ?? [], entry.run.release, settings.compare, { lastRc: choices[0] ?? null });
  if (!against || against.status !== "PASSED" || flaky.has(entry.caseId)) return null;
  return { settings, against, off: entry.regressionOff, offBy: entry.regressionOffBy, run: entry.run };
}

/** The Jira label and builds line for a bug filed from a flagged case, or null. */
export async function entryRegression(project: { id: string; groupId: string | null; platform: string }, entryId: string) {
  const c = await entryComparison(project, entryId);
  if (!c || c.off) return null;
  const now = { ...c.against, release: c.run.release, runName: c.run.name };
  const was = `Passed in ${againstLabel(c.against)}${c.against.build ? ` (build ${c.against.build})` : ""}.`;
  const is = `Fails in ${againstLabel(now)}${c.run.build ? ` (build ${c.run.build})` : ""}.`;
  return { label: c.settings.label, line: `${was} ${is}` };
}

/** Cases in this library whose latest result on some platform is a regression right now (Test cases → Regression only). */
export async function regressedCases(project: { id: string; groupId: string | null }) {
  const settings = await regressionSettingsFor(project);
  if (!settings.on) return new Set<string>();
  const rows = await db.testResult.findMany({
    where: { status: { in: VERDICTS }, entry: { testCase: { projectId: project.id, archived: false } } },
    orderBy: { createdAt: "desc" },
    take: 20000,
    select: {
      id: true,
      caseId: true,
      status: true,
      createdAt: true,
      entryId: true,
      caseVersion: true,
      testerName: true,
      entry: { select: { regressionOff: true } },
      run: { select: { number: true, name: true, release: true, build: true, project: { select: { key: true, platform: true } } } },
    },
  });
  const byCase = new Map<string, (PastResult & { off: boolean })[]>();
  for (const r of rows) {
    const list = byCase.get(r.caseId) ?? [];
    list.push({
      id: r.id,
      status: r.status,
      at: r.createdAt,
      release: r.run.release,
      build: r.run.build,
      runNumber: r.run.number,
      runName: r.run.name,
      projectKey: r.run.project.key,
      platform: r.run.project.platform,
      entryId: r.entryId,
      caseVersion: r.caseVersion,
      tester: r.testerName,
      stepStatuses: [],
      off: r.entry.regressionOff,
    });
    byCase.set(r.caseId, list);
  }
  const flaky = await flakyCases({ caseIds: [...byCase.keys()] });
  const out = new Set<string>();
  for (const [caseId, list] of byCase) {
    const marks = historyMarks(list, settings.compare, flaky.has(caseId));
    // Still broken: the newest verdict on that platform carries the flag.
    const newest = new Map<string, PastResult>();
    for (const r of list) if (!newest.has(r.platform.toLowerCase())) newest.set(r.platform.toLowerCase(), r);
    if ([...newest.values()].some((r) => marks.get(r.id) === "regression")) out.add(caseId);
  }
  return out;
}

export type RegressionRow = {
  caseId: string;
  caseKey: string;
  title: string;
  platform: string;
  lastPassed: string;
  brokeIn: string;
  now: "still" | "fixed";
  automated: boolean;
  bug: { key: string; url: string | null } | null;
  href: string;
};

const norm = (s: string) => s.trim().toLowerCase();

/** Reports → Regression: cases that passed in `older` and broke in `newer`, per platform, and whether they're still broken. */
async function compareRcs(projectIds: string[], newer: string, older: string, platform: string): Promise<RegressionRow[]> {
  const runs = await db.testRun.findMany({ where: { projectId: { in: projectIds }, release: { not: "" } }, select: { id: true, release: true, project: { select: { platform: true } } } });
  const pick = runs.filter((r) => [norm(newer), norm(older)].includes(norm(r.release)) && (!platform || norm(r.project.platform) === norm(platform)));
  if (!pick.length) return [];
  const results = await db.testResult.findMany({
    where: { runId: { in: pick.map((r) => r.id) }, status: { in: VERDICTS } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      caseId: true,
      status: true,
      automated: true,
      entryId: true,
      run: { select: { number: true, release: true, build: true, project: { select: { key: true, platform: true } } } },
      entry: { select: { regressionOff: true, title: true, testCase: { select: { number: true, project: { select: { key: true } } } } } },
      defects: { select: { defect: { select: { externalKey: true, externalUrl: true, number: true } } } },
    },
  });
  const flaky = await flakyCases({ caseIds: [...new Set(results.map((r) => r.caseId))] });
  const groups = new Map<string, typeof results>();
  for (const r of results) {
    const k = `${r.caseId}|${norm(r.run.project.platform)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rows: RegressionRow[] = [];
  for (const list of groups.values()) {
    if (flaky.has(list[0].caseId)) continue;
    const was = list.filter((r) => norm(r.run.release) === norm(older)).at(-1);
    if (was?.status !== "PASSED") continue;
    const inNew = list.filter((r) => norm(r.run.release) === norm(newer));
    const broke = inNew.find((r) => r.status !== "PASSED");
    if (!broke || broke.entry.regressionOff) continue;
    const last = inNew.at(-1)!;
    const bug = broke.defects[0]?.defect ?? last.defects[0]?.defect ?? null;
    rows.push({
      caseId: broke.caseId,
      caseKey: `${broke.entry.testCase.project.key}-${broke.entry.testCase.number}`,
      title: broke.entry.title,
      platform: broke.run.project.platform,
      lastPassed: [was.run.release.trim(), was.run.build].filter(Boolean).join(" · "),
      brokeIn: [broke.run.release.trim(), broke.run.build].filter(Boolean).join(" · "),
      now: last.status === "PASSED" ? "fixed" : "still",
      automated: broke.automated,
      bug: bug ? { key: bug.externalKey ?? `D-${bug.number}`, url: bug.externalUrl } : null,
      href: `/p/${broke.run.project.key}/runs/${broke.run.number}/execute?entry=${broke.entryId}`,
    });
  }
  return rows.sort((a, b) => (a.now === b.now ? a.caseKey.localeCompare(b.caseKey, undefined, { numeric: true }) : a.now === "still" ? -1 : 1));
}

/** The RCs in these projects, newest first. */
export async function rcList(projectIds: string[]) {
  const runs = await db.testRun.findMany({ where: { projectId: { in: projectIds }, release: { not: "" } }, select: { release: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  const seen = new Set<string>();
  return runs.flatMap((r) => (seen.has(norm(r.release)) ? [] : (seen.add(norm(r.release)), [r.release.trim()])));
}

/** The Regression report: `rc` vs `vs` (default the newest RC and the one before), on one platform or all. */
export async function regressionReport(projectIds: string[], opts: { rc?: string; vs?: string; platform?: string }) {
  const releases = await rcList(projectIds);
  const newer = releases.find((r) => norm(r) === norm(opts.rc ?? "")) ?? releases[0] ?? null;
  const at = newer ? releases.indexOf(newer) : -1;
  const older = releases.find((r) => norm(r) === norm(opts.vs ?? "") && r !== newer) ?? releases[at + 1] ?? null;
  if (!newer || !older) return { releases, newer, older, rows: [] as RegressionRow[], before: null as number | null };
  const rows = await compareRcs(projectIds, newer, older, opts.platform ?? "");
  const prev = releases[releases.indexOf(older) + 1];
  const before = prev ? (await compareRcs(projectIds, older, prev, opts.platform ?? "")).length : null;
  return { releases, newer, older, rows, before };
}

/** Release status: per platform, the regressions in this release that are still broken. */
export async function stillBrokenByPlatform(projectIds: string[], release: string) {
  const releases = await rcList(projectIds);
  const at = releases.findIndex((r) => norm(r) === norm(release));
  const older = at >= 0 ? releases[at + 1] : undefined;
  if (!older) return new Map<string, RegressionRow[]>();
  const rows = (await compareRcs(projectIds, release, older, "")).filter((r) => r.now === "still");
  const out = new Map<string, RegressionRow[]>();
  for (const r of rows) out.set(norm(r.platform), [...(out.get(norm(r.platform)) ?? []), r]);
  return out;
}

/** The test cycles a cycle's Regression report looks across: every one on its platform in the umbrella, else just itself. */
export async function regressionScope(project: { id: string; groupId: string | null; platform: string }) {
  if (!project.groupId || !project.platform) return [project.id];
  const ps = await db.project.findMany({ where: { groupId: project.groupId, platform: { equals: project.platform, mode: "insensitive" } }, select: { id: true } });
  return ps.map((p) => p.id);
}
