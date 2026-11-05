"use client";

import { useState } from "react";
import type { ReportSummary } from "@/lib/report-summary";

const Tile = ({ label, value, note, testId }: { label: string; value: string | number; note?: string; testId: string }) => (
  <div className="min-w-0 flex-1 basis-36 rounded-lg border border-slate-200 bg-surface px-3 py-2" data-testid={testId}>
    <span className="text-xs text-slate-500">{label}</span>
    <div className="text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
    {note && <span className="text-xs text-slate-500">{note}</span>}
  </div>
);

/** Reports → the one-line answer and four tiles above the tabs (persona audit #10). */
export function ReportSummaryBar({ summary }: { summary: ReportSummary }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary.line);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <section className="mb-4 grid gap-2" aria-label="Summary">
      <div className="flex flex-wrap items-start gap-2 rounded-lg bg-accent-50 px-3 py-2 text-sm text-slate-800">
        <p className="min-w-0 flex-1" data-testid="report-summary-line">
          {summary.line}
        </p>
        <button type="button" onClick={copy} className="shrink-0 font-medium text-accent-700 hover:underline" data-export-skip data-howto="reports-copy">
          {copied ? "Copied" : "Copy summary"}
        </button>
      </div>
      {summary.runs > 0 && (
        <div className="flex flex-wrap gap-2">
          <Tile testId="tile-passed" label="Passed" value={summary.passRate === null ? "–" : `${Math.round(summary.passRate * 100)}%`} />
          <Tile testId="tile-bugs" label="Open bugs" value={summary.openBugs} note={summary.critical ? `${summary.critical} critical` : undefined} />
          <Tile testId="tile-blocked" label="Blocked" value={summary.blocked} />
          <Tile testId="tile-notrun" label="Not run yet" value={summary.notRun} note="in open runs" />
        </div>
      )}
    </section>
  );
}
