import type { ResultStatus } from "@prisma/client";
import { verdictFlips } from "./run-history";
import { countStatuses, totals } from "./status";
import { bucketKey, bucketLabel } from "./trend-buckets";

// How testing is going: the run trends box on an umbrella's home. Pure, so it's
// unit tested; src/lib/home-trends.ts loads the rows. Bug bashes are left out before this.

/** One saved result, with what the box needs about its run, case and bugs. */
export type TrendRow = {
  caseId: string;
  entryId: string;
  runId: string;
  status: ResultStatus;
  at: Date;
  release: string;
  runAt: Date;
  automated: boolean;
  platform: string;
  testerName: string;
  title: string;
  caseKey: string;
  caseProjectKey: string;
  caseNumber: number;
  archived: boolean;
  bugs: { id: string; at: Date; severe: boolean; open: boolean }[];
  /** For By build: the run's link and what to call it. */
  runKey?: string;
  runNumber?: number;
  runName?: string;
  build?: string;
};

/** One automated run on By build, release or not. */
export type BuildPoint = {
  runId: string;
  href: string;
  /** The build if the run has one, else "Run 12". */
  label: string;
  name: string;
  /** When the run was saved, as an ISO string; shown in the viewer's own time. */
  at: string;
  platform: string;
  passed: number;
  failed: number;
  /** Cases with any other result (skipped, blocked…). */
  other: number;
  /** Passed out of passed and failed; null when no test passed or failed. */
  rate: number | null;
  /** A run tested by hand (By run): its size, how many are finished and how many are started. */
  manual?: { total: number; finished: number; inProgress: number; release: string };
};

/** One run tested by hand, with how many of its cases have each status now. */
export type ManualRunRow = {
  runId: string;
  href: string;
  number: number;
  name: string;
  release: string;
  at: Date;
  platform: string;
  open: boolean;
  counts: Partial<Record<ResultStatus, number>>;
};

/** Hand testing in the runs still open: finished and started cases, for the summary line. */
export type OpenManual = { total: number; finished: number; inProgress: number };

export type Rates = { man: number | null; auto: number | null };

/** One release or one week on the chart. */
export type TrendPoint = {
  key: string;
  label: string;
  man: number | null;
  auto: number | null;
  /** Pass rates per platform, manual and automated apart. */
  plat: Record<string, Rates>;
  runs: number;
  manCases: number;
  autoCases: number;
  /** Cases in the release's manual runs, tested or not (releases only). */
  planned: number;
  people: number;
  bugs: number;
  severe: number;
  openBugs: number;
};

export type TrendCase = {
  caseKey: string;
  title: string;
  href: string;
  /** Flips for the Flaky list, fails in a row for Keeps failing. */
  count: number;
  /** Last 10 results, newest first: p passed, f failed, o anything else. */
  dots: ("p" | "f" | "o")[];
  platform: string;
  automated: boolean;
};

export type HomeTrendsData = {
  release: TrendPoint[];
  week: TrendPoint[];
  /** Automated runs, oldest first, newest last. */
  build: BuildPoint[];
  /** Runs tested by hand for By run, oldest first, newest last. Bug bashes left out. */
  manualRuns: BuildPoint[];
  /** Open runs tested by hand, or null when there are none. */
  openManual: OpenManual | null;
  hasManual: boolean;
  hasAuto: boolean;
  flaky: TrendCase[];
  flakyTotal: number;
  failing: TrendCase[];
  failingTotal: number;
  /** The week the newest week point is, so "this week" reads right. */
  thisWeek: string;
};

/** Fails in a row that put a case on Keeps failing. */
export const FAIL_STREAK = 3;
/** Rows shown in each list; the rest are in Reports. */
export const LIST_ROWS = 5;
/** Weeks kept for By week: about two years. */
const MAX_WEEKS = 104;
/** Automated runs kept for By build. */
const MAX_BUILDS = 200;
const WEEK = 7 * 86400_000;

const rate = (s: ResultStatus[]) => (s.length ? totals(countStatuses(s)).passRate : null);

function point(key: string, label: string, kept: TrendRow[], bugRows: TrendRow[] | null, bugsByWeek: Map<string, TrendRow["bugs"]> | null, planned: number): TrendPoint {
  const man = kept.filter((r) => !r.automated);
  const auto = kept.filter((r) => r.automated);
  const plat: Record<string, Rates> = {};
  for (const name of new Set(kept.map((r) => r.platform).filter(Boolean))) {
    const mine = kept.filter((r) => r.platform === name);
    plat[name] = { man: rate(mine.filter((r) => !r.automated).map((r) => r.status)), auto: rate(mine.filter((r) => r.automated).map((r) => r.status)) };
  }
  // A bug counts once: for a release, any bug linked to its results; for a week, bugs recorded that week.
  const bugs = new Map<string, TrendRow["bugs"][number]>();
  if (bugRows) for (const r of bugRows) for (const b of r.bugs) bugs.set(b.id, b);
  if (bugsByWeek) for (const b of bugsByWeek.get(key) ?? []) bugs.set(b.id, b);
  const list = [...bugs.values()];
  return {
    key,
    label,
    man: rate(man.map((r) => r.status)),
    auto: rate(auto.map((r) => r.status)),
    plat,
    runs: new Set(kept.map((r) => r.runId)).size,
    manCases: man.length,
    autoCases: auto.length,
    planned,
    people: new Set(kept.map((r) => r.testerName).filter(Boolean)).size,
    bugs: list.length,
    severe: list.filter((b) => b.severe).length,
    openBugs: list.filter((b) => b.open).length,
  };
}

/**
 * Pass rates by release and by week, plus the Flaky and Keeps failing lists. Each case counts
 * once per run (its latest result); manual and automated never mix. `entries` is how many
 * cases each run has, for "of N planned".
 */
export function homeTrends(rows: TrendRow[], entries: Map<string, number>, now = new Date(), manualRows: ManualRunRow[] = []): HomeTrendsData {
  const sorted = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const latest = new Map<string, TrendRow>();
  for (const r of sorted) latest.set(r.entryId, r);
  const kept = [...latest.values()];

  // By release, in the order each release was first run.
  const rel = new Map<string, { first: Date; kept: TrendRow[]; all: TrendRow[]; runs: Set<string> }>();
  for (const r of sorted) {
    if (!r.release.trim()) continue;
    const cur = rel.get(r.release) ?? { first: r.runAt, kept: [], all: [], runs: new Set() };
    if (r.runAt < cur.first) cur.first = r.runAt;
    cur.all.push(r);
    if (!r.automated) cur.runs.add(r.runId);
    rel.set(r.release, cur);
  }
  for (const r of kept) if (r.release.trim()) rel.get(r.release)!.kept.push(r);
  const release = [...rel.entries()]
    .sort((a, b) => a[1].first.getTime() - b[1].first.getTime())
    .map(([name, v]) => point(name, name, v.kept, v.all, null, [...v.runs].reduce((n, id) => n + (entries.get(id) ?? 0), 0)));

  // By week (from Monday, UTC like Reports), every week from the first result to now so gaps show.
  const week: TrendPoint[] = [];
  const thisWeek = bucketKey(now, "week");
  if (kept.length) {
    const byWeek = new Map<string, TrendRow[]>();
    for (const r of kept) {
      const k = bucketKey(r.at, "week");
      const list = byWeek.get(k);
      if (list) list.push(r);
      else byWeek.set(k, [r]);
    }
    const bugsByWeek = new Map<string, TrendRow["bugs"]>();
    const seen = new Set<string>();
    for (const r of sorted)
      for (const b of r.bugs) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        const k = bucketKey(b.at, "week");
        const list = bugsByWeek.get(k);
        if (list) list.push(b);
        else bugsByWeek.set(k, [b]);
      }
    const last = new Date(`${thisWeek}T00:00:00Z`).getTime();
    const first = Math.max(new Date(`${bucketKey(sorted[0].at, "week")}T00:00:00Z`).getTime(), last - (MAX_WEEKS - 1) * WEEK);
    for (let t = first; t <= last; t += WEEK) {
      const k = new Date(t).toISOString().slice(0, 10);
      week.push(point(k, bucketLabel(k, "week"), byWeek.get(k) ?? [], null, bugsByWeek, 0));
    }
  }

  // By build: every automated run on its own, so one broken build stands out.
  const byRun = new Map<string, TrendRow[]>();
  for (const r of kept) {
    if (!r.automated) continue;
    const list = byRun.get(r.runId);
    if (list) list.push(r);
    else byRun.set(r.runId, [r]);
  }
  const build: BuildPoint[] = [...byRun.values()]
    .map((rs) => {
      const r = rs[0];
      const passed = rs.filter((x) => x.status === "PASSED").length;
      const failed = rs.filter((x) => x.status === "FAILED").length;
      return {
        runId: r.runId,
        href: r.runKey && r.runNumber ? `/p/${r.runKey}/runs/${r.runNumber}` : "",
        label: r.build?.trim() || `Run ${r.runNumber ?? ""}`.trim(),
        name: r.runName ?? "",
        at: r.runAt.toISOString(),
        platform: r.platform,
        passed,
        failed,
        other: rs.length - passed - failed,
        rate: passed + failed ? passed / (passed + failed) : null,
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAX_BUILDS);

  // Flaky and Keeps failing: every result of each case, newest first, like the ⚡ Flaky badge.
  const byCase = new Map<string, TrendRow[]>();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const r = sorted[i];
    if (r.archived) continue;
    const list = byCase.get(r.caseId);
    if (list) list.push(r);
    else byCase.set(r.caseId, [r]);
  }
  const flaky: TrendCase[] = [];
  const failing: TrendCase[] = [];
  for (const rs of byCase.values()) {
    const statuses = rs.map((r) => r.status);
    const newest = rs[0];
    const base = {
      caseKey: newest.caseKey,
      title: newest.title,
      href: `/p/${newest.caseProjectKey}/cases/${newest.caseNumber}`,
      dots: statuses.slice(0, 10).map((s) => (s === "PASSED" ? "p" : s === "FAILED" ? "f" : "o") as TrendCase["dots"][number]),
      platform: newest.platform,
      automated: newest.automated,
    };
    const flips = verdictFlips(statuses);
    if (flips >= 2) flaky.push({ ...base, count: flips });
    let streak = 0;
    while (streak < statuses.length && statuses[streak] === "FAILED") streak++;
    if (streak >= FAIL_STREAK) failing.push({ ...base, count: streak });
  }
  const order = (a: TrendCase, b: TrendCase) => b.count - a.count || a.caseKey.localeCompare(b.caseKey, undefined, { numeric: true });
  flaky.sort(order);
  failing.sort(order);

  return {
    release,
    week,
    build,
    ...manualRunPoints(manualRows),
    hasManual: kept.some((r) => !r.automated),
    hasAuto: kept.some((r) => r.automated),
    flaky: flaky.slice(0, LIST_ROWS),
    flakyTotal: flaky.length,
    failing: failing.slice(0, LIST_ROWS),
    failingTotal: failing.length,
    thisWeek,
  };
}

/** Not run yet: untested, started, or sent back. Everything else is finished. */
const OPEN_STATUSES: ResultStatus[] = ["UNTESTED", "IN_PROGRESS", "RETEST"];

/**
 * By run's bars for runs tested by hand, and the open ones' totals for the summary line.
 * A bar's height is the pass rate of the cases finished so far.
 */
export function manualRunPoints(runs: ManualRunRow[]): { manualRuns: BuildPoint[]; openManual: OpenManual | null } {
  const n = (r: ManualRunRow, s: ResultStatus) => r.counts[s] ?? 0;
  const sizes = (r: ManualRunRow) => {
    const total = Object.values(r.counts).reduce((a, b) => a + (b ?? 0), 0);
    return { total, finished: total - OPEN_STATUSES.reduce((a, s) => a + n(r, s), 0), inProgress: n(r, "IN_PROGRESS") };
  };
  const manualRuns = [...runs]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-MAX_BUILDS)
    .map((r) => {
      const { total, finished, inProgress } = sizes(r);
      const passed = n(r, "PASSED");
      const failed = n(r, "FAILED");
      return {
        runId: r.runId,
        href: r.href,
        label: `R${r.number}`,
        name: r.name,
        at: r.at.toISOString(),
        platform: r.platform,
        passed,
        failed,
        other: finished - passed - failed,
        rate: passed + failed ? passed / (passed + failed) : null,
        manual: { total, finished, inProgress, release: r.release },
      };
    });
  // Open runs with work left; a finished run nobody closed isn't hand testing going on.
  const open = runs.filter((r) => r.open).map(sizes).filter((x) => x.finished < x.total);
  const openManual = open.length ? open.reduce((a, b) => ({ total: a.total + b.total, finished: a.finished + b.finished, inProgress: a.inProgress + b.inProgress })) : null;
  return { manualRuns, openManual };
}

/** By run: which runs get bars. Saved for each person. */
export type RunsShown = "both" | "man" | "auto";

/** The newest bars of each kind (so an hourly CI job never pushes hand runs off), oldest first. */
export function runBars(data: Pick<HomeTrendsData, "build" | "manualRuns">, shown: RunsShown, perKind: number | null): BuildPoint[] {
  const take = (list: BuildPoint[]) => (perKind ? list.slice(-perKind) : list);
  const auto = shown === "man" ? [] : take(data.build);
  const man = shown === "auto" ? [] : take(data.manualRuns);
  return [...auto, ...man].sort((a, b) => a.at.localeCompare(b.at));
}

/** By build shows twice as many bars as releases or weeks: 12 builds unless the person picked more. */
export const buildCount = (count: number) => count * 2;

/** One line on build health: "Last 12 builds: 9 all passed, 2 had failures, 1 had no tests run". */
export function buildHealth(points: BuildPoint[]) {
  const all = points.filter((p) => p.rate === 1).length;
  const failed = points.filter((p) => p.failed > 0).length;
  const none = points.filter((p) => p.rate === null).length;
  return { all, failed, none };
}

/** How many releases or weeks the chart shows: 6 unless the person picked more (0 is all). */
export const TREND_COUNTS = [6, 10, 20, 0] as const;
export type TrendCount = (typeof TREND_COUNTS)[number];

/** Saved on the account in openCards as trends:* words, so it's the same on every computer. */
const COUNT_WORD: Record<number, string> = { 10: "trends:ten", 20: "trends:twenty", 0: "trends:all" };
export const HIDDEN_WORD = "trends:hidden";
const RUNS_WORD: Record<Exclude<RunsShown, "both">, string> = { man: "trends:runs-man", auto: "trends:runs-auto" };

export type TrendPrefs = { hidden: boolean; count: TrendCount; runs: RunsShown };

export function trendPrefs(openCards: string[]): TrendPrefs {
  const count = (Object.entries(COUNT_WORD).find(([, w]) => openCards.includes(w))?.[0] ?? "6") as `${TrendCount}`;
  const runs = (Object.entries(RUNS_WORD).find(([, w]) => openCards.includes(w))?.[0] ?? "both") as RunsShown;
  return { hidden: openCards.includes(HIDDEN_WORD), count: Number(count) as TrendCount, runs };
}

export function withTrendPrefs(openCards: string[], prefs: { hidden: boolean; count: number; runs?: RunsShown }): string[] {
  const keep = openCards.filter((w) => !w.startsWith("trends:"));
  if (prefs.hidden) keep.push(HIDDEN_WORD);
  if (COUNT_WORD[prefs.count]) keep.push(COUNT_WORD[prefs.count]);
  if (prefs.runs && prefs.runs !== "both") keep.push(RUNS_WORD[prefs.runs]);
  return keep;
}
