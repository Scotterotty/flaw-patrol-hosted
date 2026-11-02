"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SHOW_HISTORY_EVENT, STILL_OCCURS_EVENT, type HistoryRun } from "@/lib/run-history";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/status";
import { StatusChip } from "./status";
import { rowsTip } from "@/lib/test-data-history";
import { Button, cx } from "./ui";

const OPEN_KEY = "fp-history-open";

type Bug = HistoryRun["defects"][number]["defect"];
const bugKey = (d: Bug) => d.externalKey ?? `D-${d.number}`;

/** A bug's key and title, linked to Jira or to its row on the Defects page. */
function BugLink({ bug, projectKey }: { bug: Bug; projectKey: string }) {
  const label = (
    <>
      <span className="font-mono font-medium">{bugKey(bug)}</span> <span>{bug.title}</span>
    </>
  );
  return bug.externalUrl ? (
    <a href={bug.externalUrl} target="_blank" rel="noreferrer" className="hover:underline" title="Open in Jira">
      {label}
    </a>
  ) : (
    <Link href={`/p/${projectKey}/bugs#${bugKey(bug)}`} className="hover:underline" title="Recorded in Flaw Patrol. Open on the Bugs page">
      {label}
    </Link>
  );
}

/**
 * The selected case's past executions, next to the runner. Each pip is one
 * execution, oldest on the left; pick one to see its steps, or none to see the list.
 */
export function RunnerHistory({
  runs,
  summary,
  projectKey,
  canApply,
  olderNote,
}: {
  /** Updated cases: "Runs before Oct 25 used the older steps." */
  olderNote?: string;
  runs: HistoryRun[];
  summary: { passRate: string; lastPassed: string | null; flaky: boolean };
  projectKey: string;
  canApply: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Open unless this person collapsed it; remembered per browser.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) !== "0");
    } catch {}
  }, []);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {}
  };
  // The Regression note's "See what RC 21 looked like".
  useEffect(() => {
    const show = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!runs.some((r) => r.id === id)) return;
      setOpen(true);
      setSelectedId(id);
      document.querySelector('[aria-label="Execution history"]')?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    window.addEventListener(SHOW_HISTORY_EVENT, show);
    return () => window.removeEventListener(SHOW_HISTORY_EVENT, show);
  }, [runs]);
  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const pips = [...runs].reverse().slice(-30);
  const split = (r: HistoryRun) => (r.rows && r.rows.length > 1 && new Set(r.rows).size > 1 ? r.rows : null);

  const stillOccurs = (r: HistoryRun) => window.dispatchEvent(new CustomEvent<HistoryRun>(STILL_OCCURS_EVENT, { detail: r }));

  return (
    <section aria-label="Execution history" className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-surface shadow-sm">
      <div className={cx("p-3", open && "border-b border-slate-200")}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Execution history</h2>
          {runs.length > 0 && (
            <button type="button" aria-expanded={open} onClick={() => toggle(!open)} className="text-xs text-accent-700 hover:underline">
              {open ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
        {runs.length > 0 ? (
          <>
            <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Past executions, oldest first">
              {pips.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={open && r.id === selectedId}
                  aria-label={`R${r.runNumber} ${STATUS_LABEL[r.status].toLowerCase()}, ${r.ago}`}
                  title={`R${r.runNumber} ${r.runName}: ${STATUS_LABEL[r.status]}, ${r.ago}${r.rows ? `. ${rowsTip(r.rows)}` : ""}`}
                  onClick={() => {
                    toggle(true);
                    setSelectedId(r.id === selectedId && open ? null : r.id);
                  }}
                  className={cx(
                    "st-pip h-4 w-2.5 rounded-[3px] transition hover:scale-y-125",
                    split(r) ? "flex flex-col overflow-hidden" : STATUS_STYLE[r.status].bar,
                    open && r.id === selectedId && "ring-2 ring-accent-500 ring-offset-1 ring-offset-surface",
                  )}
                >
                  {/* Test data: a stripe per row when the rows didn't all end the same. */}
                  {split(r)?.map((x, j) => <span key={j} data-row-stripe className={cx("min-h-px flex-1", STATUS_STYLE[x].bar)} />)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
              {runs.length} {runs.length === 1 ? "run" : "runs"} · {summary.passRate} passed · {summary.lastPassed ? `last passed ${summary.lastPassed}` : "never passed"}
              {summary.flaky && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200">Flaky</span>}
            </p>
            {olderNote && <p className="mt-1 text-xs text-amber-800">{olderNote}</p>}
          </>
        ) : (
          <p className="mt-1 text-xs text-slate-500">This case hasn&apos;t been run before.</p>
        )}
      </div>

      <div className={cx("min-h-0 flex-1 overflow-y-auto", (!open || runs.length === 0) && "hidden")}>
        {selected ? (
          <Detail run={selected} projectKey={projectKey} canApply={canApply} onBack={() => setSelectedId(null)} onStillOccurs={() => stillOccurs(selected)} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {runs.map((r) => (
              <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                <button type="button" onClick={() => setSelectedId(r.id)} className="min-w-0 flex-1 text-left">
                  <span className="block text-slate-500">{r.ago}</span>
                  <span className="block truncate text-sm text-slate-800">
                    <span className="font-mono text-xs text-slate-500">R{r.runNumber}</span> {r.runName}
                  </span>
                  {r.meta && <span className="block truncate text-slate-500">{r.meta}</span>}
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusChip status={r.status} />
                  {r.defects.length > 0 && (
                    <span className="text-red-700" title={[...new Set(r.defects.map((d) => `${bugKey(d.defect)}: ${d.defect.title}`))].join("\n")}>
                      Bug {[...new Set(r.defects.map((d) => bugKey(d.defect)))].join(", ")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Detail({
  run,
  projectKey,
  canApply,
  onBack,
  onStillOccurs,
}: {
  run: HistoryRun;
  projectKey: string;
  canApply: boolean;
  onBack: () => void;
  onStillOccurs: () => void;
}) {
  const bugs = [...new Map(run.defects.map((d) => [d.defect.id, d.defect])).values()];
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/p/${projectKey}/runs/${run.runNumber}/execute?entry=${run.entryId}`} className="text-sm font-medium text-slate-900 hover:underline">
            <span className="font-mono text-xs text-slate-500">R{run.runNumber}</span> {run.runName}
          </Link>
          <p className="text-slate-500">
            <span title={run.at}>{run.ago}</span> · {run.testerName || "Someone"}
            {run.meta && ` · ${run.meta}`}
          </p>
        </div>
        <StatusChip status={run.status} />
      </div>

      {bugs.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2">
          <p className="font-medium text-red-800">{bugs.length === 1 ? "Bug found in this run" : `${bugs.length} bugs found in this run`}</p>
          <ul className="mt-0.5 space-y-0.5 text-red-800">
            {bugs.map((d) => (
              <li key={d.id}>
                <BugLink bug={d} projectKey={projectKey} />
              </li>
            ))}
          </ul>
          <Button size="sm" variant="primary" className="mt-2 w-full" disabled={!canApply} onClick={onStillOccurs}>
            Bug still occurs
          </Button>
          <p className="mt-1 text-[11px] text-red-700">Fills this case in with the same step results and links the same bugs.</p>
        </div>
      )}

      {run.comment && <p className="text-slate-600">“{run.comment}”</p>}

      {run.steps.length > 0 && (
        <ol className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {run.steps.map((s, i) => (
            <li key={i} className="flex gap-2 px-2 py-1.5">
              <span className="w-6 shrink-0 font-mono text-slate-500">{s.number}</span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-slate-800">{s.action}</p>
                {s.actual && <p className="mt-0.5 text-slate-500">Actual: {s.actual}</p>}
                {run.defects
                  .filter((d) => d.stepIndex === i)
                  .map((d) => (
                    <p key={d.defect.id} className="mt-0.5 text-red-700">
                      Bug: <BugLink bug={d.defect} projectKey={projectKey} />
                    </p>
                  ))}
              </div>
              {s.heading ? (
                <span className="h-fit shrink-0 text-[11px] text-slate-400 italic">heading, no result needed</span>
              ) : (
                <span className={cx("h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", STATUS_STYLE[s.status].soft)}>{STATUS_LABEL[s.status]}</span>
              )}
            </li>
          ))}
        </ol>
      )}

      {run.attachments.length > 0 && (
        <p>
          {run.attachments.map((a) => (
            <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="mr-2 text-accent-700 hover:underline">
              📎 {a.fileName}
            </a>
          ))}
        </p>
      )}

      <button type="button" onClick={onBack} className="text-accent-700 hover:underline">
        ← All executions
      </button>
    </div>
  );
}
