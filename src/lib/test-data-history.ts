import type { ResultStatus } from "@prisma/client";
import { headingRows } from "./step-checks";
import { rowResults } from "./test-data";

// History pips for cases run with test data (ver_138): each saved result's rows, from the steps
// the run snapshotted (each tagged with its row) and the step results saved with it.

/** Each row's result for one saved result, or null when that run had no test data. */
export function rowsOfResult(steps: unknown, stepResults: unknown): ResultStatus[] | null {
  if (!Array.isArray(steps) || !Array.isArray(stepResults)) return null;
  const rowOf = steps.map((s) => {
    const r = (s as { row?: unknown } | null)?.row;
    return typeof r === "number" ? r : undefined;
  });
  if (!rowOf.some((r) => r !== undefined)) return null;
  const headings = headingRows(steps);
  const statuses = stepResults.map((x) => ((x as { status?: ResultStatus } | null)?.status ?? "UNTESTED") as ResultStatus);
  const count = Math.max(...rowOf.map((r) => r ?? -1)) + 1;
  return rowResults(rowOf.map((r, i) => (headings.has(i) ? undefined : r)), statuses, count);
}

/** "Row 2 failed. Rows 1 and 3 passed." for a pip's tooltip. */
export function rowsTip(rows: ResultStatus[], label: (r: number) => string = (r) => `Row ${r + 1}`): string {
  const by = (want: (s: ResultStatus) => boolean) => rows.flatMap((s, i) => (want(s) ? [i] : []));
  const list = (ix: number[]) => (ix.length === 1 ? label(ix[0]) : `Rows ${ix.slice(0, -1).map((i) => i + 1).join(", ")} and ${ix[ix.length - 1] + 1}`);
  const parts: string[] = [];
  const failed = by((s) => s === "FAILED");
  const blocked = by((s) => s === "BLOCKED");
  const passed = by((s) => s === "PASSED");
  const other = by((s) => s !== "FAILED" && s !== "BLOCKED" && s !== "PASSED");
  if (failed.length) parts.push(`${list(failed)} failed`);
  if (blocked.length) parts.push(`${list(blocked)} blocked`);
  if (passed.length) parts.push(`${list(passed)} passed`);
  if (other.length) parts.push(`${list(other)} not passed`);
  return parts.join(". ") + ".";
}
