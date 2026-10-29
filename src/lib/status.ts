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

/** Tailwind classes per status: solid chip, soft chip, and bar segment color. */
export const STATUS_STYLE: Record<ResultStatus, { solid: string; soft: string; bar: string; hex: string }> = {
  // Bar colors are checked for color-blind separation between neighbors. Statuses
  // use fixed hues, not slate (which leans toward each person's accent color), and
  // every use also carries the status name (chip text, legend or tooltip).
  PASSED: { solid: "bg-emerald-600 text-white", soft: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "bg-emerald-600", hex: "#059669" },
  FAILED: { solid: "bg-red-600 text-white", soft: "bg-red-50 text-red-700 ring-red-200", bar: "bg-red-600", hex: "#dc2626" },
  BLOCKED: { solid: "bg-status-blocked text-white", soft: "bg-zinc-100 text-zinc-700 ring-zinc-300", bar: "bg-status-blocked", hex: "#334155" },
  RETEST: { solid: "bg-sky-700 text-white", soft: "bg-sky-50 text-sky-700 ring-sky-200", bar: "bg-sky-700", hex: "#0369a1" },
  SKIPPED: { solid: "bg-violet-400 text-white", soft: "bg-violet-50 text-violet-700 ring-violet-200", bar: "bg-violet-400", hex: "#a78bfa" },
  IN_PROGRESS: { solid: "bg-zinc-400 text-zinc-950", soft: "bg-zinc-50 text-zinc-700 ring-zinc-300", bar: "bg-zinc-400", hex: "#a1a1aa" },
  UNTESTED: { solid: "bg-slate-200 text-slate-800", soft: "bg-surface text-slate-500 ring-slate-200", bar: "bg-slate-200", hex: "#e2e8f0" },
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
