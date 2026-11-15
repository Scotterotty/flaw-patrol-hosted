"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { forgivingFilter } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "./close-matches";
import { Input } from "./ui";

type Item = { id: string; text: string; row: ReactNode; done: boolean; current: boolean };

/**
 * The run list: the runner's cases with a search box. Rows are drawn on the server; this
 * only filters them. With `tuckDone` (Assigned to me), finished cases fold into a Done
 * group at the bottom so what's left to test stays in view.
 */
export function RunnerCaseList({ items, empty, tuckDone = false }: { items: Item[]; empty: string; tuckDone?: boolean }) {
  const [query, setQuery] = useState("");
  // Open or closed, the Done group stays that way from case to case.
  const [showDone, setShowDone] = useState(false);
  useEffect(() => {
    try {
      setShowDone(localStorage.getItem("fp-run-list-done") === "1");
    } catch {}
  }, []);
  const toggleDone = () =>
    setShowDone((s) => {
      try {
        localStorage.setItem("fp-run-list-done", s ? "0" : "1");
      } catch {}
      return !s;
    });
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // Forgiving search: exact matches, then close ones under their own label.
  const found = forgivingFilter(items, query, (i) => i.text);
  const matching = words.length ? [...found.exact, ...found.close] : items;
  const closeStart = words.length && found.close.length ? found.exact.length : -1;
  // Searching shows every match; the open case never hides, even once it's saved.
  const tucking = tuckDone && !words.length;
  const shown = tucking ? matching.filter((i) => !i.done || i.current) : matching;
  const tucked = tucking ? matching.filter((i) => i.done && !i.current) : [];
  const left = items.filter((i) => !i.done).length;
  return (
    <>
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-slate-200 px-3 pt-2.5 pb-2">
        <h2 className="text-sm font-semibold text-slate-900">Run list</h2>
        <span className="text-xs text-slate-500 tabular-nums">{left === 0 ? "All done" : `${left} to go`}</span>
      </div>
      {items.length > 5 && (
        <div className="shrink-0 border-b border-slate-200 px-3 py-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Search cases"
            aria-label="Search cases in this run"
            className="h-7 text-xs"
          />
        </div>
      )}
      {/* relative (ver_260): the rows' screen-reader words are positioned, and without it they hung far below the
          list and stretched the page into a long empty scroll. */}
      <ul aria-label="Run list" className="relative max-h-[40vh] min-h-0 divide-y divide-slate-100 overflow-y-auto lg:max-h-[calc(60vh-10rem)] lg:min-h-[10rem] bigtext:max-h-[40vh]">
        {shown.map((i, n) => (
          <Fragment key={i.id}>
            {n === closeStart && (
              <li>
                {closeStart === 0 && <p className="px-3 pt-1.5 text-xs text-slate-500">No exact matches.</p>}
                <CloseMatchesLabel className="text-[11px]" />
              </li>
            )}
            <li>{i.row}</li>
          </Fragment>
        ))}
        {shown.length === 0 && !tucked.length && <li className="px-3 py-4 text-center text-xs text-slate-500">{items.length ? "No cases match." : empty}</li>}
        {shown.length === 0 && tucked.length > 0 && <li className="px-3 py-4 text-center text-xs text-slate-500">Nothing left to test. Nice work.</li>}
        {tucked.length > 0 && (
          <li>
            <button
              type="button"
              aria-expanded={showDone}
              onClick={toggleDone}
              className="flex w-full items-center gap-2 bg-slate-50 px-3 py-1.5 text-left text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              <span aria-hidden className={showDone ? "rotate-90 transition-transform" : "transition-transform"}>
                ›
              </span>
              Done ({tucked.length})
              <span className="ml-auto font-normal text-slate-500">{showDone ? "Hide" : "Show"}</span>
            </button>
            {showDone && (
              <ul className="divide-y divide-slate-100 opacity-80">
                {tucked.map((i) => (
                  <li key={i.id}>{i.row}</li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>
    </>
  );
}

/**
 * On a phone the case comes first: the run's case list folds behind a
 * "Run list (x of y)" button. From the lg breakpoint it's always shown, as before.
 */
export function RunListFold({ done, total, children }: { done: number; total: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-surface px-3 py-2 text-sm font-medium text-slate-800 shadow-sm lg:hidden bigtext:flex"
      >
        <span>
          Run list ({done} of {total})
        </span>
        <span aria-hidden className="text-slate-400">
          {open ? "▴" : "▾"}
        </span>
      </button>
      <div className={open ? "contents" : "hidden lg:contents bigtext:hidden"}>{children}</div>
    </>
  );
}
