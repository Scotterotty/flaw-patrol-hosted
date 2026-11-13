"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SharedFilters } from "@/lib/bugs-view";
import { saveBugsPicks } from "@/server/bug-board";
import { Button, cx, Input, Select } from "./ui";

/**
 * The Bugs page's shared filter bar (ver_232), the same in Table and Board: the Jira board,
 * Search, Found in testing, Mine, Version, Priority and Label. Picks go in the web address, so
 * the Table | Board switch keeps them; the board and Found in testing are also saved on the
 * person's account. Table reloads its list from the server; Board filters in the browser.
 */
export function BugsFilterBar({
  mode,
  boards,
  board,
  filters,
  versions,
  labels,
  priorities,
  children,
}: {
  mode: "table" | "board";
  boards: { id: string; name: string }[];
  board: { id: string; name: string } | null;
  filters: SharedFilters;
  versions: string[];
  labels: string[];
  priorities: string[];
  /** The view's own extra filters, after the shared ones. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const go = (patch: Record<string, string | null>, reload = mode === "table") => {
    const s = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) if (v) s.set(k, v);
    else s.delete(k);
    const href = `?${s}`;
    if (reload) router.replace(href, { scroll: false });
    else window.history.replaceState(null, "", href);
  };
  const search = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (mode === "board") go({ q: v.trim() ? v : null });
    else timer.current = setTimeout(() => go({ q: v.trim() ? v : null }), 450);
  };
  const found = (on: boolean) => {
    go({ found: on ? "1" : "all" });
    // Table reloads, and the page saves the pick; Board filters here, so it saves it itself.
    if (mode === "board") void saveBugsPicks({ found: on });
  };
  const pickBoard = (id: string) => go({ board: id }, true);
  const filtered = !!(filters.q || filters.mine || filters.version || filters.label || filters.priority);
  const sorted = (list: string[], extra: string) => [...new Set([...list, ...(extra ? [extra] : [])])];

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="bugs-filter-bar">
      {boards.length > 1 && board && (
        <Select value={board.id} onChange={(e) => pickBoard(e.target.value)} aria-label="Jira board" className="w-auto" data-howto="bugs-board-pick">
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              Jira board: {b.name}
            </option>
          ))}
        </Select>
      )}
      <Input type="search" value={q} onChange={(e) => search(e.target.value)} onKeyDown={(e) => e.key === "Enter" && mode === "table" && (timer.current && clearTimeout(timer.current), go({ q: q.trim() ? q : null }))} placeholder="Search bugs" aria-label="Search bugs" data-howto="board-search" className="w-56 max-w-full" />
      <Chip on={filters.found} onClick={() => found(!filters.found)} howto="board-found">
        Found in testing
      </Chip>
      <Chip on={filters.mine} onClick={() => go({ mine: filters.mine ? null : "1" })}>
        Mine
      </Chip>
      {(versions.length > 0 || filters.version) && (
        <Select value={filters.version} onChange={(e) => go({ version: e.target.value || null })} aria-label="Version" className="w-auto">
          <option value="">Any version</option>
          {sorted(versions, filters.version).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </Select>
      )}
      {(priorities.length > 0 || filters.priority) && (
        <Select value={filters.priority} onChange={(e) => go({ priority: e.target.value || null })} aria-label="Priority" className="w-auto">
          <option value="">Any priority</option>
          {sorted(priorities, filters.priority).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </Select>
      )}
      {(labels.length > 0 || filters.label) && (
        <Select value={filters.label} onChange={(e) => go({ label: e.target.value || null })} aria-label="Label" className="w-auto">
          <option value="">Any label</option>
          {sorted(labels, filters.label).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </Select>
      )}
      {children}
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            go({ q: null, mine: null, version: null, priority: null, label: null });
          }}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

export function Chip({ on, onClick, howto, children }: { on: boolean; onClick: () => void; howto?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-howto={howto}
      className={cx("inline-flex h-9 items-center rounded-full border px-3 text-sm", on ? "border-accent-500 bg-accent-50 font-medium text-accent-700" : "border-slate-200 text-slate-700 hover:border-accent-500")}
    >
      {children}
    </button>
  );
}

/** The line under the filters: which bugs you're looking at, and how to see the rest. */
export function ShowingLine({ shown, found, board, more }: { shown: number; found: boolean; board: string | null; more?: number }) {
  const bugs = `${shown} ${shown === 1 ? "bug" : "bugs"}`;
  const on = board ? ` on ${board}` : "";
  return (
    <p className="text-sm text-slate-600" data-testid="bugs-showing" role="status">
      Showing <b className="font-semibold text-slate-900">{bugs}</b> {found ? `found in testing${on}.` : `${board ? `from ${board}` : "on the board"}, found in testing or not.`}
      {found && more ? (
        <>
          {" "}
          Turn off <b className="font-semibold text-slate-900">Found in testing</b> to see all {more}.
        </>
      ) : null}
    </p>
  );
}
