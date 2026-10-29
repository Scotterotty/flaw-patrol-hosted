import type { Priority, ResultStatus } from "@prisma/client";

// How case lists in suites, runs and the runner are ordered: the suite's own
// order, highest priority first, or (in runs) by status with the work still to
// do first. Only the display changes; positions and
// version history stay as they are. Remembered per browser in a cookie.

export const CASE_SORT_COOKIE = "fp-case-sort";
export type CaseSort = "order" | "priority" | "status";

export const parseCaseSort = (v: string | undefined | null): CaseSort => (v === "priority" || v === "status" ? v : "order");

/** Status order for runs: half-done and untested first, then problems, then the finished ones. */
export const STATUS_SORT: ResultStatus[] = ["IN_PROGRESS", "UNTESTED", "RETEST", "FAILED", "BLOCKED", "SKIPPED", "PASSED"];

const RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Highest priority first, or by status (when statusOf is given; lists without
 * statuses, like suites, keep their order). Ties keep their original order. Returns a new array.
 */
export function sortCases<T>(items: readonly T[], sort: CaseSort, priorityOf: (item: T) => Priority, statusOf?: (item: T) => ResultStatus): T[] {
  if (sort === "order" || (sort === "status" && !statusOf)) return [...items];
  const rank = sort === "status" ? (item: T) => STATUS_SORT.indexOf(statusOf!(item)) : (item: T) => RANK[priorityOf(item)];
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i)
    .map((x) => x.item);
}
