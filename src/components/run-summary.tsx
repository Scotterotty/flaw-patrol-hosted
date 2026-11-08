"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The run page's one summary box (ver_200): done, passed and the bug count on one line, the
 * status bar, and who's done how many. The bug lists (found in this run, and known bugs from
 * earlier runs) open under See bugs instead of taking three boxes above the cases.
 */
export function RunSummary({
  done,
  passed,
  passedTip,
  newBugs,
  knownBugs,
  bar,
  testers,
  bugs,
}: {
  done: string;
  passed: string;
  passedTip: string;
  newBugs: number;
  knownBugs: number;
  bar: ReactNode;
  testers: ReactNode;
  bugs: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Old links to #known-bugs still open the list.
  useEffect(() => {
    const check = () => window.location.hash === "#known-bugs" && setOpen(true);
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const anyBugs = newBugs + knownBugs > 0;
  return (
    <section aria-label="Run summary" className="mb-4 rounded-lg border border-slate-200 bg-surface p-3 shadow-sm" data-testid="run-summary">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-slate-600">
        <span>
          <b className="text-lg font-semibold text-slate-900 tabular-nums">{done}</b> done
        </span>
        <span title={passedTip} data-testid="run-pass-rate">
          <b className="text-lg font-semibold text-slate-900 tabular-nums">{passed}</b> passed
        </span>
        {anyBugs && (
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <span aria-hidden>🐞</span>
            {newBugs > 0 && (
              <span>
                <b className="text-slate-900 tabular-nums">{newBugs}</b> new
              </span>
            )}
            {newBugs > 0 && knownBugs > 0 && <span aria-hidden>·</span>}
            {knownBugs > 0 && (
              <span>
                <b className="text-slate-900 tabular-nums">{knownBugs}</b> known
              </span>
            )}
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="ml-1 text-xs font-medium text-accent-700 hover:underline" data-howto="run-see-bugs">
              {open ? "Hide bugs" : "See bugs"}
            </button>
          </span>
        )}
      </div>
      <div className="mt-2">{bar}</div>
      <div className="mt-2 text-xs text-slate-500" data-testid="by-tester">
        {testers}
      </div>
      {open && anyBugs && <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">{bugs}</div>}
    </section>
  );
}
