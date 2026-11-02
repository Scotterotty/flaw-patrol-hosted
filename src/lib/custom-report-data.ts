import "server-only";
import { caseHealth, defectReport, parseFilters, runReport, stepHistory, suiteReport, trends, type ReportFilters, type ReportScope, type RunRow } from "./reports";
import { regressionReport } from "./regression-data";
import { severityScaleFor } from "./severity-server";
import { listWrapUps, releaseStart } from "./wrap-ups";
import { cleanReportQuery, REPORT_KEYS } from "./report-query";
import type { OwnFilters } from "./report-parts";
import type { ExportCtx } from "./report-export";

// Custom reports (ver_101): where a report's numbers come from, shared by its page and its export.

/** A test cycle's or an umbrella's Reports, as a custom report sees them. */
export type CustomScope = {
  umbrella: boolean;
  /** The test cycle, or the umbrella's hub: where reports are kept and whose severity names apply. */
  homeId: string;
  homeKey: string;
  /** Every test cycle the page covers (the umbrella's, or just this one). */
  allIds: string[];
  /** The runs to count: an umbrella narrowed to one platform has fewer. */
  scope: ReportScope;
  /** Projects whose suites the Test suites part lists. */
  library: string[];
  regressionIds: string[];
  regressionPlatform?: string;
  /** "/p/ABC/reports" or "/g/123/reports". */
  reportsBase: string;
  title: string;
  exportCtx: (f: ReportFilters, sp: Record<string, string | undefined>) => ExportCtx;
};

/** The filters a report shows: the ones in the link when there are any, else the report's own. */
export function reportQuery(saved: string, sp: Record<string, string | undefined>) {
  const fromLink = cleanReportQuery({ ...sp, view: undefined });
  // f=1: the filters were changed on the page, even when that cleared them all.
  return fromLink || sp.f === "1" ? fromLink : saved;
}
export const queryObject = (q: string): Record<string, string | undefined> => Object.fromEntries(new URLSearchParams(q));

/** A part's filters: the report's, with its own on top. */
export function partQuery(base: Record<string, string | undefined>, own?: OwnFilters): Record<string, string | undefined> {
  if (!own) return base;
  const q = { ...base };
  if (own.release) Object.assign(q, { release: own.release, from: undefined, to: undefined, range: undefined, run: undefined });
  if (own.allTime) Object.assign(q, { range: "all", from: undefined, to: undefined, run: undefined });
  return q;
}

export function filtersOf(cs: CustomScope, q: Record<string, string | undefined>) {
  // Run numbers repeat between test cycles, so an umbrella has no run filter.
  return parseFilters(cs.umbrella ? { ...q, run: undefined } : q);
}

/** Loads each kind of data once per filter set, however many parts use it. */
export function loader(cs: CustomScope) {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(kind: string, f: ReportFilters, fn: () => Promise<T>): Promise<T> => {
    const k = `${kind}|${JSON.stringify(f)}`;
    if (!memo.has(k)) memo.set(k, fn());
    return memo.get(k) as Promise<T>;
  };
  return {
    runs: (f: ReportFilters) => once("runs", f, () => runReport(cs.scope, f)),
    suites: (f: ReportFilters, runs: RunRow[]) => once("suites", f, () => suiteReport(cs.library, runs)),
    trends: (f: ReportFilters) => once("trends", f, () => trends(cs.scope, f)),
    steps: (f: ReportFilters) => once("steps", f, () => stepHistory(cs.scope, f)),
    defects: (f: ReportFilters) => once("defects", f, () => defectReport(cs.scope, f)),
    cases: (f: ReportFilters) => once("cases", f, () => caseHealth(cs.scope, f)),
    scale: () => once("scale", {} as ReportFilters, () => severityScaleFor(cs.homeId)),
    regression: () => once("regression", {} as ReportFilters, () => regressionReport(cs.regressionIds, { platform: cs.regressionPlatform })),
    wrapUps: (f: ReportFilters) =>
      once("wrap", f, async () => {
        const since = f.release ? await releaseStart(cs.allIds, f.release) : f.allTime ? undefined : f.from;
        return listWrapUps(cs.allIds, { since: since ?? undefined, until: f.release || f.allTime ? undefined : f.to });
      }),
  };
}
export type Loader = ReturnType<typeof loader>;

/** The report's filters in words, for page 1 of the PDF and the Excel sheet. */
export function filterWords(cs: CustomScope, q: Record<string, string | undefined>, when: string) {
  const kind = q.runs === "manual" ? "Tested by hand" : q.runs === "automated" ? "Automated" : q.runs === "bash" ? "Bug bash" : "";
  return [cs.umbrella ? `Umbrella: ${cs.title}` : `Test cycle: ${cs.title}`, ...(q.platform ? [`Platform: ${q.platform}`] : []), `When: ${when}`, ...(kind ? [`Runs: ${kind}`] : [])];
}

export { REPORT_KEYS };
