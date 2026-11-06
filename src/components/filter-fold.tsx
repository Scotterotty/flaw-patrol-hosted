"use client";

import { useEffect, useState, type ReactNode } from "react";

const KEY = "fp-report-filters-open";

/**
 * Reports' filters behind one Filter button (ver_187): the answer comes first, and the
 * dozen dropdowns only when you ask for them. The count says how many are set. Once you
 * open it, it stays open on your next visit (this browser only), for people who filter every day.
 */
export function FilterFold({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "1") setOpen(true);
    } catch {}
  }, []);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? "0" : "1");
      } catch {}
      return !o;
    });
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid="report-filter-toggle"
        data-howto="reports-filter-open"
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400"
      >
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        Filter{count > 0 ? ` (${count})` : ""}
        <span aria-hidden className="text-xs text-slate-400">{open ? "▴" : "▾"}</span>
      </button>
      <div hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  );
}
