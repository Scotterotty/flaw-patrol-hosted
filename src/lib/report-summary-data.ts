// Server side of the Reports summary line: open bugs in the range and the folder
// with the most failures. See report-summary.ts for the sentence itself.
import { countedRuns } from "./bash-runs";
import { db } from "./db";
import { reportSummary, topFailFolder } from "./report-summary";
import { defectReport, type ReportFilters, type ReportScope, type RunRow } from "./reports";

export async function summaryFor(scope: ReportScope, f: ReportFilters, runs: RunRow[], label: string) {
  const counted = countedRuns(runs, f.kind);
  const failedIds = [...new Set(counted.flatMap((r) => r.caseStatuses.filter(([, s]) => s === "FAILED").map(([id]) => id)))];
  const [bugs, failed] = await Promise.all([
    counted.length ? defectReport(scope, f) : Promise.resolve([]),
    failedIds.length ? db.testCase.findMany({ where: { id: { in: failedIds } }, select: { folder: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  return reportSummary(
    label,
    counted,
    bugs.map((b) => ({ open: b.open, severity: b.severity })),
    topFailFolder(failed.map((c) => c.folder?.name ?? null)),
  );
}
