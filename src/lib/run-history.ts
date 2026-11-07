import type { ResultStatus } from "@prisma/client";

// One past execution of a case, as the runner's history panel shows it.
export type HistoryRun = {
  id: string;
  ago: string;
  at: string;
  entryId: string;
  runNumber: number;
  runName: string;
  /** Its version, or the day it started (ver_189: in place of "R3"). */
  runTag: string;
  meta: string;
  status: ResultStatus;
  comment: string;
  testerName: string;
  caseVersion: number;
  /** Test data: each row's result, or null when that run had none. */
  rows?: ResultStatus[] | null;
  /** `heading` marks a shared step's heading row, which takes no result. */
  steps: { number: string; action: string; status: ResultStatus; actual: string; heading?: boolean }[];
  defects: {
    stepIndex: number | null;
    defect: { id: string; number: number; title: string; externalKey: string | null; externalUrl: string | null; status: string };
  }[];
  attachments: { id: string; fileName: string }[];
  /** The run is still open: shown as In progress and not counted yet (ver_195). */
  open: boolean;
};

/** Regression note: "See what RC 21 looked like" opens that result in the history panel. */
export const SHOW_HISTORY_EVENT = "flaw-patrol:show-history";

/** "Bug still occurs" hands a past run to the runner on the same page. */
export const STILL_OCCURS_EVENT = "flaw-patrol:still-occurs";

/** How often the verdict flipped between passed and failed in the last 10 runs (newest first). */
export function verdictFlips(newestFirst: ResultStatus[]): number {
  const verdicts = newestFirst.slice(0, 10).filter((s) => s === "PASSED" || s === "FAILED");
  return verdicts.slice(1).filter((s, i) => s !== verdicts[i]).length;
}

/** Flaky: the verdict flipped between passed and failed at least twice in the last 10 runs (newest first). */
export function isFlaky(newestFirst: ResultStatus[]): boolean {
  return verdictFlips(newestFirst) >= 2;
}

/** The hover tip on a Flaky badge. */
export const flakyTip = (flips: number) => `Flaky: its result flipped between Passed and Failed ${flips} times in its last 10 runs.`;

/**
 * Where each step of a past run lands in the case being tested now: the same
 * position when the steps line up, otherwise the step with the same text.
 */
export function mapHistorySteps(past: { action: string }[], current: { action: string }[]): number[] {
  const sameShape = past.length === current.length;
  return past.map((s, i) => (sameShape ? i : current.findIndex((c) => c.action.trim() === s.action.trim())));
}

/**
 * One result per run (ver_195): saving a case again in the same run replaces its
 * earlier save, so history shows each run once with its latest result. `saves`
 * keeps every save, newest first, so bugs found on an earlier save stay listed.
 * Groups come back newest first.
 */
export function onePerRun<T extends { entryId: string; createdAt: Date }>(rows: T[]): { latest: T; saves: T[] }[] {
  const by = new Map<string, T[]>();
  for (const r of rows) by.set(r.entryId, [...(by.get(r.entryId) ?? []), r]);
  return [...by.values()]
    .map((saves) => {
      const sorted = [...saves].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { latest: sorted[0], saves: sorted };
    })
    .sort((a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime());
}

/** The latest save per run only, newest first. */
export const latestPerRun = <T extends { entryId: string; createdAt: Date }>(rows: T[]): T[] => onePerRun(rows).map((g) => g.latest);

/** A run's result counts toward pass rate, "last passed" and Flaky only once the run is closed. */
export const countsInHistory = (run: { state: string }) => run.state === "COMPLETED";

/** Every bug linked on any save in the run, the latest save's links first, each bug once. */
export function bugsAcrossSaves<L extends { defect: { id: string } }>(saves: { defects: L[] }[]): L[] {
  const seen = new Map<string, L>();
  for (const s of saves) for (const l of s.defects) if (!seen.has(l.defect.id)) seen.set(l.defect.id, l);
  return [...seen.values()];
}

/** Files attached on any save in the run, each once. */
export function filesAcrossSaves<A extends { id: string }>(saves: { attachments: A[] }[]): A[] {
  const seen = new Map<string, A>();
  for (const s of saves) for (const a of s.attachments) if (!seen.has(a.id)) seen.set(a.id, a);
  return [...seen.values()];
}

/** The history summary line before any run has closed. */
export const NOT_COUNTED_YET = "Counts once the run closes";
