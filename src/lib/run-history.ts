import type { ResultStatus } from "@prisma/client";

// One past execution of a case, as the runner's history panel shows it.
export type HistoryRun = {
  id: string;
  ago: string;
  at: string;
  entryId: string;
  runNumber: number;
  runName: string;
  meta: string;
  status: ResultStatus;
  comment: string;
  testerName: string;
  caseVersion: number;
  /** `heading` marks a shared step's heading row, which takes no result (ver_110). */
  steps: { number: string; action: string; status: ResultStatus; actual: string; heading?: boolean }[];
  defects: {
    stepIndex: number | null;
    defect: { id: string; number: number; title: string; externalKey: string | null; externalUrl: string | null; status: string };
  }[];
  attachments: { id: string; fileName: string }[];
};

/** Regression note (ver_93): "See what RC 21 looked like" opens that result in the history panel. */
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
