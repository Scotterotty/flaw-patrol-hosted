import type { ResultStatus } from "@prisma/client";

// Execution statuses, shared by the runner, run pages and reports.

export const STATUSES: ResultStatus[] = ["PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED", "IN_PROGRESS", "UNTESTED"];

/** Statuses a tester can set on a step or a case, with their keyboard key. */
export const SETTABLE: { status: ResultStatus; key: string }[] = [
  { status: "PASSED", key: "p" },
  { status: "FAILED", key: "f" },
  { status: "BLOCKED", key: "b" },
  { status: "RETEST", key: "r" },
  { status: "SKIPPED", key: "s" },
];

export const STATUS_LABEL: Record<ResultStatus, string> = {
  UNTESTED: "Untested",
  PASSED: "Passed",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  RETEST: "Retest",
  SKIPPED: "Skipped",
  IN_PROGRESS: "In progress",
};

export const STATUS_HELP: Record<ResultStatus, string> = {
  UNTESTED: "Not run yet",
  PASSED: "Worked as expected",
  FAILED: "Didn't do what was expected; file or link a bug for it",
  BLOCKED: "Couldn't be run, for example because an earlier step or environment broke",
  RETEST: "Needs running again, for example after a fix",
  SKIPPED: "Deliberately not run this time",
  IN_PROGRESS: "Some steps have results, but the case isn't finished",
};

/**
 * Classes per status: solid chip, soft chip, and bar segment. They read the --st-* CSS
 * variables (ver_96), so Account → Color vision can swap them for one person; bar
 * segments also carry st-bar-<STATUS> for the stripes and dots of Shapes and patterns.
 * `hex` is the standard color, for shared files (exports, Download image, Confluence)
 * that everyone sees the same; `fill` is the on-screen color for SVG and inline styles.
 */
export const STATUS_STYLE: Record<ResultStatus, { solid: string; soft: string; bar: string; ink: string; hex: string; fill: string }> = {
  // Statuses use fixed hues, not slate (which leans toward each person's accent color),
  // and every use also carries the status name (chip text, legend or tooltip).
  PASSED: { solid: "bg-st-passed text-st-passed-on", soft: "bg-st-passed-soft text-st-passed-ink ring-st-passed-ring", bar: "bg-st-passed st-bar-PASSED", ink: "text-st-passed-ink", hex: "#059669", fill: "var(--st-passed)" },
  FAILED: { solid: "bg-st-failed text-st-failed-on", soft: "bg-st-failed-soft text-st-failed-ink ring-st-failed-ring", bar: "bg-st-failed st-bar-FAILED", ink: "text-st-failed-ink", hex: "#dc2626", fill: "var(--st-failed)" },
  BLOCKED: { solid: "bg-st-blocked text-st-blocked-on", soft: "bg-st-blocked-soft text-st-blocked-ink ring-st-blocked-ring", bar: "bg-st-blocked st-bar-BLOCKED", ink: "text-st-blocked-ink", hex: "#334155", fill: "var(--st-blocked)" },
  RETEST: { solid: "bg-st-retest text-st-retest-on", soft: "bg-st-retest-soft text-st-retest-ink ring-st-retest-ring", bar: "bg-st-retest st-bar-RETEST", ink: "text-st-retest-ink", hex: "#0369a1", fill: "var(--st-retest)" },
  SKIPPED: { solid: "bg-st-skipped text-st-skipped-on", soft: "bg-st-skipped-soft text-st-skipped-ink ring-st-skipped-ring", bar: "bg-st-skipped st-bar-SKIPPED", ink: "text-st-skipped-ink", hex: "#a78bfa", fill: "var(--st-skipped)" },
  IN_PROGRESS: { solid: "bg-st-progress text-st-progress-on", soft: "bg-st-progress-soft text-st-progress-ink ring-st-progress-ring", bar: "bg-st-progress st-bar-IN_PROGRESS", ink: "text-st-progress-ink", hex: "#a1a1aa", fill: "var(--st-progress)" },
  UNTESTED: { solid: "bg-st-untested text-st-untested-on", soft: "bg-st-untested-soft text-st-untested-ink ring-st-untested-ring", bar: "bg-st-untested st-bar-UNTESTED", ink: "text-st-untested-ink", hex: "#e2e8f0", fill: "var(--st-untested)" },
};

// Worst first: the case result is the most serious step outcome.
const SEVERITY: ResultStatus[] = ["FAILED", "BLOCKED", "RETEST", "PASSED", "SKIPPED", "IN_PROGRESS", "UNTESTED"];

/**
 * Suggested case status from its step statuses. Any failed step fails the case;
 * otherwise blocked and retest win in that order. A case only passes
 * when every step was passed or skipped and at least one passed. While some
 * steps are still untested the case stays untested unless something already
 * went wrong.
 */
export function deriveCaseStatus(steps: ResultStatus[]): ResultStatus {
  if (steps.length === 0) return "UNTESTED";
  const set = new Set(steps);
  for (const s of ["FAILED", "BLOCKED", "RETEST"] as ResultStatus[]) if (set.has(s)) return s;
  if (set.has("UNTESTED")) return "UNTESTED";
  if (set.has("PASSED")) return "PASSED";
  return "SKIPPED";
}

export function worst(statuses: ResultStatus[]): ResultStatus {
  return [...statuses].sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b))[0] ?? "UNTESTED";
}

export type StatusCounts = Record<ResultStatus, number>;

export function countStatuses(statuses: ResultStatus[]): StatusCounts {
  const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as StatusCounts;
  for (const s of statuses) c[s]++;
  return c;
}

export function totals(c: StatusCounts) {
  const total = STATUSES.reduce((n, s) => n + c[s], 0);
  const tested = total - OPEN.reduce((n, st) => n + c[st], 0);
  return {
    total,
    tested,
    progress: total ? tested / total : 0,
    // Pass rate over cases that got a verdict; skipped ones don't count either way.
    passRate: tested - c.SKIPPED > 0 ? c.PASSED / (tested - c.SKIPPED) : null,
  };
}

/**
 * Not run yet: untested, part done, or sent back to run again. Every other
 * result counts as run (Skipped too, as a deliberate choice), on every page.
 */
export const OPEN: ResultStatus[] = ["UNTESTED", "IN_PROGRESS", "RETEST"];
export const isOpen = (s: ResultStatus) => OPEN.includes(s);

export const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
