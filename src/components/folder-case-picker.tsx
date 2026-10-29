"use client";

import { useMemo, useState } from "react";
import { buildTree, type FolderNode, type FolderRow } from "@/lib/folders";
import { Button, cx, Input } from "./ui";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export type PickerCase = { id: string; key: string; title: string; folderId: string | null };

/**
 * Choose from folders… (ver_91): the Case library as a tree. Tick a folder to take every
 * case in it and its subfolders, or open it and tick single cases. A dash means partly picked.
 */
export function FolderCasePicker({
  title,
  folders,
  cases,
  value,
  onChange,
  onDone,
}: {
  title: string;
  folders: FolderRow[];
  cases: PickerCase[];
  value: string[];
  onChange: (ids: string[]) => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const picked = useMemo(() => new Set(value), [value]);
  const tree = useMemo(() => buildTree(folders), [folders]);
  const needle = q.trim().toLowerCase();
  const matches = (c: PickerCase) => !needle || c.title.toLowerCase().includes(needle) || c.key.toLowerCase().includes(needle);
  // Cases in each folder and everything under it, in library order.
  const under = useMemo(() => {
    const direct = new Map<string, PickerCase[]>();
    for (const c of cases) if (c.folderId) direct.set(c.folderId, [...(direct.get(c.folderId) ?? []), c]);
    const all = new Map<string, PickerCase[]>();
    const walk = (n: FolderNode): PickerCase[] => {
      const list = [...(direct.get(n.id) ?? []), ...n.children.flatMap(walk)];
      all.set(n.id, list);
      return list;
    };
    tree.forEach(walk);
    return { direct, all };
  }, [cases, tree]);
  const loose = cases.filter((c) => !c.folderId || !under.all.has(c.folderId));

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    // Keep library order, so the run lists cases the way the library does.
    onChange(cases.filter((c) => next.has(c.id)).map((c) => c.id));
  };
  const toggleOpen = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const caseRow = (c: PickerCase, depth: number) => (
    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md py-1 pr-2 text-sm hover:bg-slate-50" style={{ paddingLeft: depth * 16 + 28 }}>
      <input type="checkbox" className="accent-accent-600" checked={picked.has(c.id)} onChange={() => setMany([c.id], !picked.has(c.id))} />
      <span className="font-mono text-xs text-slate-500">{c.key}</span>
      <span className="min-w-0 flex-1 truncate text-slate-800">{c.title}</span>
    </label>
  );

  const folderRow = (n: FolderNode): React.ReactNode => {
    const all = under.all.get(n.id) ?? [];
    const shown = all.filter(matches);
    if (needle && !shown.length) return null;
    const have = all.filter((c) => picked.has(c.id)).length;
    const state = have === 0 ? "none" : have === all.length ? "all" : "some";
    // Searching opens every folder with a match.
    const isOpen = !!needle || open.has(n.id);
    const own = (under.direct.get(n.id) ?? []).filter(matches);
    return (
      <div key={n.id}>
        <div className="flex items-center gap-2 rounded-md py-1 pr-2 text-sm hover:bg-slate-50" style={{ paddingLeft: n.depth * 16 + 4 }}>
          <button type="button" className="w-4 text-xs text-slate-500" aria-label={`${isOpen ? "Close" : "Open"} ${n.name}`} aria-expanded={isOpen} onClick={() => toggleOpen(n.id)}>
            {isOpen ? "▾" : "▸"}
          </button>
          <input
            type="checkbox"
            className="accent-accent-600"
            aria-label={`All of ${n.name}`}
            disabled={!all.length}
            checked={state === "all"}
            ref={(el) => {
              if (el) el.indeterminate = state === "some";
            }}
            onChange={() => setMany(all.map((c) => c.id), state !== "all")}
          />
          <button type="button" className="min-w-0 flex-1 truncate text-left font-medium text-slate-900" onClick={() => toggleOpen(n.id)}>
            {n.name}
          </button>
          <span className="text-xs whitespace-nowrap text-slate-500">
            {have} of {all.length}
            {state === "all" && all.length > 0 ? " · whole folder" : ""}
          </span>
        </div>
        {isOpen && (
          <>
            {n.children.map(folderRow)}
            {own.map((c) => caseRow(c, n.depth + 1))}
          </>
        )}
      </div>
    );
  };

  const looseShown = loose.filter(matches);
  return (
    <div className="mt-1 rounded-lg border border-slate-200 bg-surface p-2 shadow-lg" role="group" aria-label={title}>
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <Input aria-label="Search cases" placeholder="Search cases" className="h-8 w-48" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {tree.map(folderRow)}
        {looseShown.length > 0 && (
          <>
            {tree.length > 0 && <p className="mt-1 px-2 pt-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Not in a folder</p>}
            {looseShown.map((c) => caseRow(c, -1))}
          </>
        )}
        {!cases.length && <p className="px-2 py-2 text-sm text-slate-500">The Case library has no cases yet.</p>}
        {cases.length > 0 && needle && !tree.some((n) => (under.all.get(n.id) ?? []).some(matches)) && !looseShown.length && (
          <p className="px-2 py-2 text-sm text-slate-500">No cases match “{q.trim()}”.</p>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-1 pt-2">
        <span className={cx("text-xs", value.length ? "text-slate-700" : "text-slate-500")}>
          {plural(value.length, "case")} picked. Cases added to a folder later join the next release, not this one.
        </span>
        <span className="flex gap-1.5">
          <Button size="sm" variant="ghost" disabled={!value.length} onClick={() => onChange([])}>
            Clear
          </Button>
          <Button size="sm" variant="primary" onClick={onDone}>
            Done
          </Button>
        </span>
      </div>
    </div>
  );
}
