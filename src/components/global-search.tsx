"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CloseMatchesLabel } from "./close-matches";
import { rememberOpened, searchEverything, searchStart, type RecentItem, type SearchGroup, type SearchHit, type SearchKind } from "@/server/search";
import { cx } from "./ui";
import { turnOnTool } from "@/server/tools";
import { findHowTo, isHowToQuery } from "@/lib/how-to";
import { openHowTo } from "./how-to-guide";
import { useSpell } from "./spelling";

const KIND_LABEL: Record<SearchKind, string> = { cases: "Test cases", runs: "Test runs", bugs: "Bugs", cycles: "Umbrellas and test cycles", suites: "Suites and shared steps", pages: "Pages" };
const FILTERS: [SearchKind | "all", string][] = [
  ["all", "All"],
  ["cases", "Cases"],
  ["runs", "Runs"],
  ["bugs", "Bugs"],
  ["cycles", "Cycles"],
  ["suites", "Suites & shared"],
  ["pages", "Pages"],
];

/** guide: a How-to guide row ("" opens the guide's task list). */
type Row = { id: string; hit: SearchHit; kind: SearchKind; seeAll?: boolean; close?: boolean; guide?: string };

/**
 * Ctrl+K search: a Search button in the top bar and a dialog that finds cases,
 * runs, bugs, test cycles, suites and pages. Find and open only.
 */
export function GlobalSearch({ scope }: { scope: { id: string; name: string } | null }) {
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        title={`Search cases, runs, bugs, test cycles and pages (${mac ? "⌘K" : "Ctrl+K"})`}
        aria-label="Search"
        data-howto="top-search"
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-surface px-2 text-sm text-slate-500 hover:border-slate-300 hover:text-slate-800 sm:w-48 sm:px-2.5"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 flex-none" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m13 13 4 4" strokeLinecap="round" />
        </svg>
        <span className="hidden flex-1 text-left sm:inline">Search</span>
        <kbd className="hidden rounded border border-slate-200 px-1 font-sans text-[11px] text-slate-500 sm:inline">{mac ? "⌘ K" : "Ctrl K"}</kbd>
      </button>
      {open && (
        <SearchDialog
          scope={scope}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}

function SearchDialog({ scope: start, onClose }: { scope: { id: string; name: string } | null; onClose: () => void }) {
  const router = useRouter();
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState(start);
  const [filter, setFilter] = useState<SearchKind | "all">("all");
  const [archived, setArchived] = useState(false);
  const [groups, setGroups] = useState<SearchGroup[] | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [goTo, setGoTo] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    input.current?.focus();
    searchStart(start?.id ?? null).then((r) => {
      if (!r.ok) return;
      setRecent(r.recent);
      setGoTo(r.goTo);
    });
  }, [start]);

  useEffect(() => {
    if (!q.trim()) {
      setGroups(null);
      return;
    }
    let live = true;
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await searchEverything({ q, groupId: scope?.id ?? null, archived });
      if (!live) return;
      setBusy(false);
      setGroups(r.ok ? r.groups : []);
      setActive(0);
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, scope, archived]);

  const spell = useSpell();
  const shown = useMemo(() => (groups ?? []).filter((g) => filter === "all" || g.kind === filter), [groups, filter]);
  // "how do I…" (or help, guide): the How-to guide's matching tasks come first, and Enter opens the guide.
  const guideRows: Row[] = useMemo(() => {
    if (!isHowToQuery(q) || (filter !== "all" && filter !== "pages")) return [];
    const tasks = findHowTo(q).slice(0, 4);
    return [
      ...tasks.map((t) => ({ id: `${ids}-guide-${t.id}`, hit: { href: "#how-to-guide", label: spell(t.title), sub: `How-to guide · ${spell(t.sub)}` }, kind: "pages" as const, guide: t.id })),
      { id: `${ids}-guide-all`, hit: { href: "#how-to-guide", label: "Open the How-to guide", sub: "Every task, step by step, with Show me" }, kind: "pages" as const, guide: "" },
    ];
  }, [q, filter, ids, spell]);
  const rows: Row[] = useMemo(() => {
    return q.trim()
    ? [...guideRows, ...shown.flatMap((g) => [
        ...g.hits.map((hit, i) => ({ id: `${ids}-${g.kind}-${i}`, hit, kind: g.kind })),
        ...(g.seeAll && g.total > g.hits.length ? [{ id: `${ids}-${g.kind}-all`, hit: { href: g.seeAll, label: `See all ${g.total} ${KIND_LABEL[g.kind].toLowerCase()} for “${q.trim()}”`, sub: "" }, kind: g.kind, seeAll: true }] : []),
        // Close matches always come after the exact ones.
        ...g.close.map((hit, i) => ({ id: `${ids}-${g.kind}-c${i}`, hit, kind: g.kind, close: true })),
      ])]
    : [...recent.map((r, i) => ({ id: `${ids}-recent-${i}`, hit: { href: r.href, label: r.label, sub: r.sub }, kind: r.kind })), ...goTo.map((g, i) => ({ id: `${ids}-go-${i}`, hit: g, kind: "pages" as const }))];
  }, [shown, q, ids, recent, goTo, guideRows]);
  const total = shown.reduce((n, g) => n + g.total, 0);
  const closeTotal = shown.reduce((n, g) => n + g.close.length, 0);

  const openRow = useCallback(
    (row: Row, newTab: boolean) => {
      if (row.guide !== undefined) {
        onClose();
        openHowTo(row.guide || undefined);
        return;
      }
      if (!row.seeAll) void rememberOpened({ href: row.hit.href, label: row.hit.key ? `${row.hit.key} ${row.hit.label}` : row.hit.label, kind: row.kind, sub: row.hit.sub.slice(0, 300) });
      if (newTab) {
        window.open(row.hit.href, "_blank", "noopener");
        return;
      }
      onClose();
      router.push(row.hit.href);
    },
    [onClose, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && rows[active]) {
      e.preventDefault();
      openRow(rows[active], e.ctrlKey || e.metaKey);
    } else if (e.key === "Backspace" && !q && scope) {
      setScope(null);
    }
  };

  useEffect(() => {
    document.getElementById(rows[active]?.id ?? "")?.scrollIntoView({ block: "nearest" });
  }, [active, rows]);

  const renderRow = (row: Row, i: number) => (
    <li
      key={row.id}
      id={row.id}
      role="option"
      aria-selected={i === active}
      onMouseMove={() => setActive(i)}
      onClick={(e) => openRow(row, e.ctrlKey || e.metaKey)}
      className={cx("flex cursor-pointer items-start gap-2 border-l-4 px-3 py-2 text-sm", i === active ? "border-accent-600 bg-accent-50" : "border-transparent")}
    >
      {row.seeAll ? (
        <span className="text-accent-700">{row.hit.label} →</span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {row.hit.key && <span className="font-mono text-xs text-slate-500">{row.hit.key}</span>}
            <span className="truncate font-medium text-slate-900">{row.hit.label}</span>
            {row.hit.best && <span className="rounded bg-accent-100 px-1.5 text-[10px] font-semibold text-accent-700">Best match</span>}
            {row.hit.archived && <span className="rounded bg-orange-50 px-1.5 text-[10px] font-medium text-orange-700">Archived</span>}
          </span>
          {row.hit.sub && <span className="block truncate text-xs text-slate-500">{row.hit.sub}</span>}
        </span>
      )}
      {/* A page whose tool is off: Admins turn it on right here, then it opens. */}
      {row.hit.off?.canTurnOn && (
        <button
          type="button"
          className="flex-none rounded-md bg-accent-600 px-2 py-1 text-xs font-medium text-white hover:bg-accent-700"
          onClick={async (e) => {
            e.stopPropagation();
            const r = await turnOnTool(row.hit.off!.groupId, row.hit.off!.tool);
            if (r.ok) openRow({ ...row, hit: { ...row.hit, off: undefined } }, false);
          }}
        >
          Turn on
        </button>
      )}
    </li>
  );

  let index = 0;
  return (
    <dialog
      ref={dialog}
      aria-label="Search"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="mx-auto mt-[8vh] mb-auto w-[calc(100%-2rem)] max-w-2xl rounded-lg bg-surface p-0 shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-slate-200 p-3">
        <div className="flex items-center gap-2">
          {scope && (
            <span className="flex flex-none items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-800" title={`Only shows things in ${scope.name}. Remove it (or press Backspace in an empty box) to search everywhere you have access.`}>
              In {scope.name}
              <button type="button" aria-label="Search everywhere" className="text-accent-700 hover:text-accent-900" onClick={() => setScope(null)}>
                ✕
              </button>
            </span>
          )}
          <input
            ref={input}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={`${ids}-list`}
            aria-activedescendant={rows[active]?.id}
            aria-autocomplete="list"
            aria-label="Search cases, runs, bugs, test cycles and pages"
            data-howto="search-input"
            placeholder="Search cases, runs, bugs, test cycles and pages"
            className="min-w-0 flex-1 bg-transparent py-1 text-base text-slate-900 outline-none placeholder:text-slate-400"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="flex-none cursor-pointer rounded border border-slate-200 px-1 text-[11px] text-slate-500" title="Press Esc to close" onClick={onClose}>
            Esc
          </kbd>
          <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="flex-none rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            ✕
          </button>
        </div>
        {q.trim() && (
          <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="Show only">
            {FILTERS.map(([k, label]) => {
              const n = (groups ?? []).filter((g) => k === "all" || g.kind === k).reduce((s, g) => s + g.total + g.close.length, 0);
              return (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cx("rounded-full px-2 py-0.5 text-xs", filter === k ? "bg-accent-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
                  {label} {groups && <span className="tabular-nums opacity-80">{n}</span>}
                </button>
              );
            })}
            <label className="ml-auto flex items-center gap-1 text-xs text-slate-600" title="Archived umbrellas, test cycles, runs and cases are left out unless this is on">
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Include archived
            </label>
          </div>
        )}
      </div>
      <div className="max-h-[60vh] overflow-y-auto" id={`${ids}-list`} role="listbox" aria-label="Results">
        {!q.trim() ? (
          <>
            {recent.length > 0 && (
              <ul role="group" aria-label="Recent">
                <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Recent
                </li>
                {rows.slice(0, recent.length).map((r) => renderRow(r, index++))}
              </ul>
            )}
            {goTo.length > 0 && (
              <ul role="group" aria-label="Go to">
                <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Go to
                </li>
                {rows.slice(recent.length).map((r) => renderRow(r, index++))}
              </ul>
            )}
            {!recent.length && !goTo.length && <p className="px-3 py-6 text-center text-sm text-slate-500">Type a case key, a Jira key, a name or a page.</p>}
          </>
        ) : groups && !shown.length && !guideRows.length ? (
          <div className="px-3 py-6 text-center text-sm text-slate-500">
            No matches for “{q.trim()}”{scope ? ` in ${scope.name}` : ""}.
            {scope && (
              <button type="button" className="ml-1 font-medium text-accent-700 hover:underline" onClick={() => setScope(null)}>
                Search everywhere
              </button>
            )}
          </div>
        ) : (
          <>
          {guideRows.length > 0 && (
            <ul role="group" aria-label="How-to guide" data-testid="search-how-to">
              <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                How-to guide
              </li>
              {guideRows.map((r) => renderRow(r, index++))}
            </ul>
          )}
          {shown.map((g) => {
            const mine = rows.filter((r) => r.kind === g.kind && r.guide === undefined);
            return (
              <ul key={g.kind} role="group" aria-label={`${KIND_LABEL[g.kind]}, ${g.hits.length} of ${g.total}`}>
                <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  {KIND_LABEL[g.kind]} <span className="font-normal normal-case">· {g.total}</span>
                </li>
                {!g.hits.length && (
                  <li role="presentation" className="px-3 py-1 text-xs text-slate-500">
                    No exact matches.
                  </li>
                )}
                {mine.map((r, i) => (
                  <Fragment key={r.id}>
                    {r.close && !mine[i - 1]?.close && <CloseMatchesLabel as="li" />}
                    {renderRow(r, index++)}
                  </Fragment>
                ))}
              </ul>
            );
          })}
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-3 border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
        <span>↑ ↓ move</span>
        <span>Enter open</span>
        <span>Ctrl + Enter new tab</span>
        <span>Tab filters</span>
        <span className="ml-auto" aria-live="polite">
          {busy ? "Searching…" : q.trim() && groups ? `${total} ${total === 1 ? "result" : "results"}${closeTotal ? ` · ${closeTotal} close` : ""}` : ""}
        </span>
      </div>
    </dialog>
  );
}
