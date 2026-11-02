import { titleWithTags } from "./tags";
import "server-only";
import type { Prisma, Priority, ResultStatus } from "@prisma/client";
import { db } from "./db";
import { caseKey } from "./format";
import { countStatuses, totals, type StatusCounts } from "./status";
import { withoutHeadings } from "./step-checks";
import { suiteForCases } from "./suite-match";
import { bucketKey, bucketKeys, bucketLabel, unitFor, type BucketUnit } from "./trend-buckets";

export type ReportFilters = {
  allTime?: boolean;
  from: Date;
  to: Date;
  suiteId?: string;
  release?: string;
  runNumber?: number;
  // Trends only: narrow to cases of one priority, tag or folder, or one tester's results.
  priority?: Priority;
  tag?: string;
  folder?: string;
  tester?: string;
  /** Only runs tested by hand, or only uploaded and GitHub-pulled ones. */
  kind?: RunKind;
  /** One kind of run (ver_95), or "none" for plain runs. See src/lib/run-kinds.ts. */
  runKind?: string;
};

export type RunKind = "manual" | "automated" | "bash";

const PRIORITIES: Priority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export function parseFilters(sp: Record<string, string | undefined>): ReportFilters {
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999Z`) : new Date();
  // range=all means since the first run.
  const from = sp.range === "all" ? new Date(0) : sp.from ? new Date(`${sp.from}T00:00:00Z`) : new Date(to.getTime() - 30 * 86400_000);
  return {
    allTime: sp.range === "all",
    from: isNaN(from.getTime()) ? new Date(Date.now() - 30 * 86400_000) : from,
    to: isNaN(to.getTime()) ? new Date() : to,
    suiteId: sp.suite || undefined,
    release: sp.release || undefined,
    runNumber: sp.run ? Number(sp.run) || undefined : undefined,
    priority: PRIORITIES.find((p) => p === sp.priority),
    tag: sp.tag || undefined,
    folder: sp.folder || undefined,
    tester: sp.tester || undefined,
    kind: sp.runs === "manual" || sp.runs === "automated" || sp.runs === "bash" ? sp.runs : undefined,
    runKind: sp.kind?.slice(0, 40) || undefined,
  };
}

/** Whose runs a report covers: one project, or several (an umbrella's test cycles). */
export type ReportScope = string | string[];
const inScope = (scope: ReportScope) => (Array.isArray(scope) ? { in: scope } : scope);

export function runWhere(scope: ReportScope, f: ReportFilters): Prisma.TestRunWhereInput {
  const w: Prisma.TestRunWhereInput = { projectId: inScope(scope) };
  // Manual leaves out bug bashes, which have their own choice (ver_94).
  if (f.kind === "bash") w.bugBash = { isNot: null };
  else if (f.kind) {
    w.automated = f.kind === "automated";
    if (f.kind === "manual") w.bugBash = { is: null };
  }
  if (f.runKind) w.kind = f.runKind === "none" ? "" : f.runKind;
  if (f.runNumber) w.number = f.runNumber;
  else {
    if (!f.release) w.createdAt = { gte: f.from, lte: f.to };
    if (f.suiteId) w.suiteId = f.suiteId;
    if (f.release) w.release = f.release;
  }
  return w;
}

export type RunRow = {
  id: string;
  /** A bug bash's run (ver_124): kept out of the Reports summary's run count. */
  bash?: boolean;
  /** The test cycle the run belongs to: run numbers are only unique within it. */
  projectKey: string;
  projectName: string;
  platform: string;
  number: number;
  name: string;
  suite: string;
  suiteVersion: number | null;
  release: string;
  build: string;
  cspVersion: string;
  fields: unknown;
  createdAt: Date;
  state: string;
  counts: StatusCounts;
  steps: StatusCounts;
  defects: number;
  /** Tested by hand, uploaded from a results file, or pulled from GitHub. */
  source: "manual" | "upload" | "github";
  githubRunNo: number | null;
  sourceFile: string;
  suiteId: string | null;
  caseIds: string[];
  /** Each case's status in the run, for the manual vs automated split (ver_95). */
  caseStatuses: [string, ResultStatus][];
};

/** Run-by-run execution status, with step outcomes from each case's latest result. */
export async function runReport(scope: ReportScope, f: ReportFilters): Promise<RunRow[]> {
  const runs = await db.testRun.findMany({
    where: runWhere(scope, f),
    orderBy: Array.isArray(scope) ? { createdAt: "desc" } : { number: "desc" },
    take: 500,
    include: {
      project: { select: { key: true, name: true, platform: true } },
      suite: { select: { name: true } },
      entries: { select: { caseId: true, status: true, steps: true, results: { orderBy: { createdAt: "desc" }, take: 1, select: { stepResults: true } } } },
      results: { select: { defects: { select: { defectId: true } } } },
      bugBash: { select: { id: true } },
    },
  });
  return runs.map((r) => ({
    bash: !!r.bugBash,
    id: r.id,
    projectKey: r.project.key,
    projectName: r.project.name,
    platform: r.project.platform,
    number: r.number,
    name: r.name,
    suite: r.suite?.name ?? "",
    suiteVersion: r.suiteVersion,
    release: r.release,
    build: r.build,
    cspVersion: r.cspVersion,
    fields: r.fields,
    createdAt: r.createdAt,
    state: r.state,
    counts: countStatuses(r.entries.map((e) => e.status)),
    // Heading rows in shared steps take no result, so they aren't steps (ver_110).
    steps: countStatuses(r.entries.flatMap((e) => withoutHeadings(e.steps, (e.results[0]?.stepResults as { status: ResultStatus }[] | undefined) ?? []).map((s) => s.status))),
    defects: new Set(r.results.flatMap((x) => x.defects.map((d) => d.defectId))).size,
    source: !r.automated ? "manual" : r.githubRepoId || r.githubRunId ? "github" : "upload",
    githubRunNo: r.githubRunNo,
    sourceFile: r.sourceFile,
    suiteId: r.suiteId,
    caseIds: r.entries.map((e) => e.caseId),
    caseStatuses: r.entries.map((e) => [e.caseId, e.status] as [string, ResultStatus]),
  }));
}

export type SuiteRow = { id: string; name: string; version: number; runs: number; latest: RunRow | null; cases: number };

/** `projectIds`: the project plus, under an umbrella, its hub, whose shared suites it runs too. */
export async function suiteReport(projectIds: string[], runs: RunRow[]): Promise<SuiteRow[]> {
  const suites = await db.testSuite.findMany({
    where: { projectId: { in: projectIds }, archived: false },
    orderBy: { name: "asc" },
    include: { _count: { select: { cases: true } }, cases: { where: { testCase: { archived: false } }, select: { caseId: true } } },
  });
  // Runs with no suite count for the suite whose cases they are exactly.
  const sets = suites.map((s) => ({ id: s.id, caseIds: s.cases.map((c) => c.caseId) }));
  const credited = new Map(runs.filter((r) => !r.suiteId).map((r) => [r, suiteForCases(sets, r.caseIds)?.id]));
  return suites.map((s) => {
    const mine = runs.filter((r) => (r.suiteId ? r.suiteId === s.id : credited.get(r) === s.id));
    return { id: s.id, name: s.name, version: s.currentVersion, runs: mine.length, latest: mine[0] ?? null, cases: s._count.cases };
  });
}

export type StepHistory = {
  caseKey: string;
  /** Where the case lives (an umbrella's Case library for most test cycle runs), for its link. */
  caseProjectKey: string;
  caseNumber: number;
  title: string;
  step: string;
  action: string;
  /** Times the step was run (one per run, from each run's latest result). */
  runs: number;
  /** Failed: the software didn't do what the step expects. */
  failures: number;
  failed: number;
  blocked: number;
  failRate: number;
  /** Oldest first, for a history strip. */
  history: { status: ResultStatus; run: number; projectKey: string; release: string; at: Date }[];
  lastFailed: { run: number; projectKey: string; release: string; at: Date } | null;
  /** Consecutive failures up to the latest run. */
  streak: number;
  bugs: string[];
};

const FAILING = new Set<ResultStatus>(["FAILED"]);

/**
 * Every step's outcomes across runs in the period, for steps that failed at
 * least once, worst first. Steps are matched across case versions by case and
 * step text, so renumbering a step keeps its history.
 */
export async function stepHistory(scope: ReportScope, f: ReportFilters): Promise<StepHistory[]> {
  const results = await db.testResult.findMany({
    where: { run: runWhere(scope, f) },
    orderBy: { createdAt: "asc" },
    select: {
      entryId: true,
      createdAt: true,
      stepResults: true,
      run: { select: { number: true, release: true, project: { select: { key: true } } } },
      entry: { select: { title: true, steps: true, testCase: { select: { number: true, project: { select: { key: true } } } } } },
      defects: { select: { stepIndex: true, defect: { select: { number: true, externalKey: true } } } },
    },
    take: 20000,
  });
  // A case can be saved more than once in a run; keep its latest result.
  const latest = new Map<string, (typeof results)[number]>();
  for (const r of results) latest.set(r.entryId, r);

  const agg = new Map<string, StepHistory>();
  for (const r of [...latest.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const steps = (r.entry.steps as { number: string; action: string; row?: number }[]) ?? [];
    // Test data (ver_138): a step of a row reads "2 (row 2)", so the row that failed is named.
    const num = (st: { number: string; row?: number }) => (typeof st.row === "number" ? `${st.number} (row ${st.row + 1})` : st.number);
    ((r.stepResults as { status: ResultStatus }[]) ?? []).forEach((s, i) => {
      const step = steps[i];
      if (!step || s.status === "UNTESTED") return;
      const key = caseKey(r.entry.testCase.project.key, r.entry.testCase.number);
      const k = `${key}|${step.action.trim().toLowerCase()}`;
      const cur = agg.get(k) ?? {
        caseKey: key,
        caseProjectKey: r.entry.testCase.project.key,
        caseNumber: r.entry.testCase.number,
        title: r.entry.title,
        step: num(step),
        action: step.action,
        runs: 0,
        failures: 0,
        failed: 0,
        blocked: 0,
        failRate: 0,
        history: [],
        lastFailed: null,
        streak: 0,
        bugs: [],
      };
      // Latest wording and numbering win.
      cur.title = r.entry.title;
      cur.step = num(step);
      cur.runs++;
      if (s.status === "FAILED") cur.failed++;
      if (s.status === "BLOCKED") cur.blocked++;
      const at = { run: r.run.number, projectKey: r.run.project.key, release: r.run.release, at: r.createdAt };
      cur.history.push({ status: s.status, ...at });
      if (FAILING.has(s.status)) {
        cur.failures++;
        cur.lastFailed = at;
        cur.streak++;
      } else if (s.status !== "SKIPPED") cur.streak = 0;
      for (const d of r.defects) {
        const bug = d.defect.externalKey ?? `D-${d.defect.number}`;
        if (d.stepIndex === i && !cur.bugs.includes(bug)) cur.bugs.push(bug);
      }
      agg.set(k, cur);
    });
  }
  return [...agg.values()]
    .filter((s) => s.failures > 0 || s.blocked > 0)
    .map((s) => ({ ...s, failRate: s.failures / Math.max(1, s.runs - s.history.filter((h) => h.status === "SKIPPED").length) }))
    .sort((a, b) => b.failures - a.failures || b.failRate - a.failRate || b.blocked - a.blocked);
}

export type DefectRow = {
  key: string;
  url: string | null;
  title: string;
  status: string;
  open: boolean;
  severity: string;
  foundIn: { caseKey: string; step: number | null; run: number; release: string }[];
  createdAt: Date;
};

/** Defects linked to results in the period. */
export async function defectReport(scope: ReportScope, f: ReportFilters): Promise<DefectRow[]> {
  const defects = await db.defect.findMany({
    where: { projectId: inScope(scope), links: { some: { result: { run: runWhere(scope, f) } } } },
    orderBy: { createdAt: "desc" },
    include: {
      links: {
        where: { result: { run: runWhere(scope, f) } },
        include: { result: { select: { run: { select: { number: true, release: true } }, entry: { select: { testCase: { select: { number: true, project: { select: { key: true } } } } } } } } },
      },
    },
  });
  return defects.map((d) => ({
    key: d.externalKey ?? `D-${d.number}`,
    url: d.externalUrl,
    title: d.title,
    status: d.externalStatus ?? d.status,
    open: d.status === "OPEN",
    severity: d.severity,
    foundIn: d.links.map((l) => ({
      caseKey: caseKey(l.result.entry.testCase.project.key, l.result.entry.testCase.number),
      step: l.stepIndex === null ? null : l.stepIndex + 1,
      run: l.result.run.number,
      release: l.result.run.release,
    })),
    createdAt: d.createdAt,
  }));
}

export type CaseHealthRow = { caseKey: string; caseProjectKey: string; number: number; title: string; tags: string[]; runs: number; passRate: number | null; failStreak: number; flips: number; last: ResultStatus; lastAt: Date };

/** Per-case execution health in the period: most failing, flaky, long-failing. */
export async function caseHealth(scope: ReportScope, f: ReportFilters): Promise<CaseHealthRow[]> {
  const results = await db.testResult.findMany({
    where: { run: runWhere(scope, f) },
    orderBy: { createdAt: "asc" },
    select: { caseId: true, status: true, createdAt: true, entry: { select: { title: true, testCase: { select: { number: true, tags: true, project: { select: { key: true } } } } } } },
    take: 50000,
  });
  const by = new Map<string, typeof results>();
  for (const r of results) by.set(r.caseId, [...(by.get(r.caseId) ?? []), r]);
  return [...by.values()].map((rs) => {
    const statuses = rs.map((r) => r.status);
    const verdicts = statuses.filter((s) => s === "PASSED" || s === "FAILED");
    let streak = 0;
    for (let i = statuses.length - 1; i >= 0 && statuses[i] === "FAILED"; i--) streak++;
    const last = rs[rs.length - 1];
    return {
      caseKey: caseKey(last.entry.testCase.project.key, last.entry.testCase.number),
      caseProjectKey: last.entry.testCase.project.key,
      number: last.entry.testCase.number,
      ...titleWithTags(last.entry.title, last.entry.testCase.tags),
      runs: rs.length,
      passRate: totals(countStatuses(statuses)).passRate,
      failStreak: streak,
      flips: verdicts.slice(1).filter((s, i) => s !== verdicts[i]).length,
      last: last.status,
      lastAt: last.createdAt,
    };
  });
}

export type TesterRow = { name: string; results: number; counts: StatusCounts; minutes: number };

export async function testerReport(scope: ReportScope, f: ReportFilters): Promise<TesterRow[]> {
  const results = await db.testResult.findMany({
    where: { run: runWhere(scope, f) },
    select: { testerName: true, status: true, elapsedSec: true },
  });
  const by = new Map<string, { statuses: ResultStatus[]; sec: number }>();
  for (const r of results) {
    const cur = by.get(r.testerName) ?? { statuses: [], sec: 0 };
    cur.statuses.push(r.status);
    cur.sec += r.elapsedSec ?? 0;
    by.set(r.testerName, cur);
  }
  return [...by.entries()]
    .map(([name, v]) => ({ name, results: v.statuses.length, counts: countStatuses(v.statuses), minutes: Math.round(v.sec / 60) }))
    // A to Z, never by most results: this isn't a leaderboard (ver_91).
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function releaseOptions(scope: ReportScope) {
  const rows = await db.testRun.findMany({ where: { projectId: inScope(scope), release: { not: "" } }, distinct: ["release"], select: { release: true }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.release);
}

export type TrendBucket = {
  key: string;
  label: string;
  counts: StatusCounts;
  passRate: number | null;
  bugs: number;
  /** Pass rate of hand testing and of automation on their own (ver_95). */
  manualRate?: number | null;
  autoRate?: number | null;
};
export type ReleaseTrend = { release: string; firstRun: Date; runs: number; counts: StatusCounts; passRate: number | null; bugs: number };
export type Trends = { unit: BucketUnit; buckets: TrendBucket[]; releases: ReleaseTrend[]; results: number; manual: number; automated: number };

/**
 * Results and bugs over time. Each case counts once per run (its latest saved
 * result), in the period that result was saved. Bugs count in the period they
 * were recorded in Flaw Patrol.
 */
export async function trends(scope: ReportScope, f: ReportFilters): Promise<Trends> {
  const entry: Prisma.RunEntryWhereInput = {};
  if (f.priority) entry.priority = f.priority;
  if (f.folder) entry.folderPath = { startsWith: f.folder };
  if (f.tag) entry.testCase = { tags: { has: f.tag } };
  const results = await db.testResult.findMany({
    where: { run: runWhere(scope, f), entry, ...(f.tester ? { testerName: f.tester } : {}) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      entryId: true,
      status: true,
      createdAt: true,
      run: { select: { id: true, release: true, createdAt: true, automated: true } },
      defects: { select: { defectId: true, defect: { select: { createdAt: true } } } },
    },
    take: 50000,
  });
  const latest = new Map<string, (typeof results)[number]>();
  for (const r of results) latest.set(r.entryId, r);
  const kept = [...latest.values()];

  const first = kept[0]?.createdAt;
  const from = f.allTime || f.release || f.runNumber ? (first ?? f.from) : f.from;
  const to = f.allTime || f.release || f.runNumber ? (kept[kept.length - 1]?.createdAt ?? f.to) : f.to;
  const unit = unitFor(from, to);

  const statuses = new Map<string, ResultStatus[]>();
  const bySide = { manual: new Map<string, ResultStatus[]>(), auto: new Map<string, ResultStatus[]>() };
  for (const r of kept) {
    const k = bucketKey(r.createdAt, unit);
    statuses.set(k, [...(statuses.get(k) ?? []), r.status]);
    const side = r.run.automated ? bySide.auto : bySide.manual;
    side.set(k, [...(side.get(k) ?? []), r.status]);
  }
  // A bug counts once, in the period it was found (recorded or first linked).
  const firstSeen = new Map<string, Date>();
  for (const r of results) for (const d of r.defects) firstSeen.set(d.defectId, d.defect.createdAt);
  const bugs = new Map<string, number>();
  for (const at of firstSeen.values()) bugs.set(bucketKey(at, unit), (bugs.get(bucketKey(at, unit)) ?? 0) + 1);

  const buckets = bucketKeys(from, to, unit).map((key) => {
    const counts = countStatuses(statuses.get(key) ?? []);
    return {
      key,
      label: bucketLabel(key, unit),
      counts,
      passRate: totals(counts).passRate,
      bugs: bugs.get(key) ?? 0,
      manualRate: totals(countStatuses(bySide.manual.get(key) ?? [])).passRate,
      autoRate: totals(countStatuses(bySide.auto.get(key) ?? [])).passRate,
    };
  });

  const rel = new Map<string, { firstRun: Date; runs: Set<string>; statuses: ResultStatus[]; bugs: Set<string> }>();
  for (const r of kept) {
    if (!r.run.release) continue;
    const cur = rel.get(r.run.release) ?? { firstRun: r.run.createdAt, runs: new Set(), statuses: [], bugs: new Set() };
    if (r.run.createdAt < cur.firstRun) cur.firstRun = r.run.createdAt;
    cur.runs.add(r.run.id);
    cur.statuses.push(r.status);
    rel.set(r.run.release, cur);
  }
  for (const r of results) if (r.run.release) for (const d of r.defects) rel.get(r.run.release)?.bugs.add(d.defectId);
  const releases = [...rel.entries()]
    .map(([release, v]) => {
      const counts = countStatuses(v.statuses);
      return { release, firstRun: v.firstRun, runs: v.runs.size, counts, passRate: totals(counts).passRate, bugs: v.bugs.size };
    })
    .sort((a, b) => a.firstRun.getTime() - b.firstRun.getTime());

  return { unit, buckets, releases, results: kept.length, manual: kept.filter((r) => !r.run.automated).length, automated: kept.filter((r) => r.run.automated).length };
}

/** Choices for the trend filters. */
export async function trendOptions(scope: ReportScope) {
  const run = { projectId: inScope(scope) };
  const [testers, cases, folders] = await Promise.all([
    db.testResult.findMany({ where: { run, testerName: { not: "" } }, distinct: ["testerName"], select: { testerName: true }, orderBy: { testerName: "asc" } }),
    // Tags of the cases these runs ran, wherever the cases live (an umbrella's Case library, say).
    db.testCase.findMany({ where: { archived: false, runEntries: { some: { run } } }, select: { tags: true } }),
    db.runEntry.findMany({ where: { run, folderPath: { not: "" } }, distinct: ["folderPath"], select: { folderPath: true }, orderBy: { folderPath: "asc" } }),
  ]);
  return {
    testers: testers.map((t) => t.testerName),
    tags: [...new Set(cases.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b)),
    folders: folders.map((x) => x.folderPath),
  };
}
