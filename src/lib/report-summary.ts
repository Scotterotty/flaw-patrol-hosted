// Reports summary line (ver_124, persona audit #10): one sentence above the tabs that answers
// "how are we doing?" for whatever dates and filters are picked, plus four tiles and a plain-text
// copy for Slack or email. Pure, so it's unit tested.
import { countStatuses, OPEN, STATUSES, totals, type StatusCounts } from "./status";
import type { ResultStatus } from "@prisma/client";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export type SummaryRun = { state: string; counts: StatusCounts };
export type SummaryBug = { open: boolean; severity: string };

export type ReportSummary = {
  /** "Oct 1 to 31", "Release 2.1", "Run R4" or "All time". */
  scope: string;
  runs: number;
  passRate: number | null;
  openBugs: number;
  critical: number;
  blocked: number;
  /** Cases not run yet, counted only in runs that are still open. */
  notRun: number;
  topFolder: string | null;
  line: string;
};

const CRITICAL = new Set(["SHOWSTOPPER", "CRITICAL"]);

export function reportSummary(scope: string, runs: SummaryRun[], bugs: SummaryBug[], topFolder: string | null = null): ReportSummary {
  const all = countStatuses(runs.flatMap((r) => STATUSES.flatMap((s) => Array<ResultStatus>(r.counts[s]).fill(s))));
  const { passRate } = totals(all);
  const open = bugs.filter((b) => b.open);
  const critical = open.filter((b) => CRITICAL.has(b.severity)).length;
  const notRun = runs.filter((r) => r.state === "ACTIVE").reduce((n, r) => n + OPEN.reduce((m, s) => m + r.counts[s], 0), 0);
  const base = { scope, runs: runs.length, passRate, openBugs: open.length, critical, blocked: all.BLOCKED, notRun, topFolder };
  if (!runs.length) return { ...base, line: `No runs ${scope === "All time" ? "yet" : scopeWords(scope)}.` };
  const parts = [
    `${plural(runs.length, "run")}${passRate === null ? "" : `, ${Math.round(passRate * 100)}% passed`}.`,
    open.length ? `${plural(open.length, "open bug")}${critical ? `, ${critical} critical` : ""}.` : "No open bugs.",
    all.BLOCKED ? `${all.BLOCKED} ${all.BLOCKED === 1 ? "case" : "cases"} blocked.` : "",
    topFolder ? `Most failures are in ${topFolder}.` : "",
  ].filter(Boolean);
  return { ...base, line: `${scope}: ${parts.join(" ")}` };
}

/** "No runs from Oct 1 to 31" reads better than "No runs Oct 1 to 31". */
function scopeWords(scope: string) {
  return /^(Release|Run) /.test(scope) ? `in ${scope}` : `from ${scope}`;
}

/** The folder with the most failed cases, if any case failed. Ties go to the name that sorts first. */
export function topFailFolder(failedFolders: (string | null)[]): string | null {
  const n = new Map<string, number>();
  for (const f of failedFolders) if (f) n.set(f, (n.get(f) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, v] of [...n].sort((a, b) => a[0].localeCompare(b[0]))) if (best === null || v > n.get(best)!) best = k;
  return best;
}
