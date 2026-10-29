"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CoverageCell, CoverageRow } from "@/lib/story-coverage";
import { linkStory } from "@/server/stories";
import { StatusChip } from "./status";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Input } from "./ui";

const TONE: Record<CoverageCell["tone"], string> = {
  pass: "text-emerald-800",
  fail: "font-semibold text-red-800",
  run: "text-slate-700",
  none: "text-slate-500",
};

/** Coverage written out ("2 failed", "No cases"), never by color alone. */
export function Cell({ c }: { c: CoverageCell }) {
  return <span className={TONE[c.tone]}>{c.text}</span>;
}

const TYPE_TONE: Record<string, string> = {
  epic: "bg-violet-50 text-violet-800 ring-violet-200",
  story: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  requirement: "bg-sky-50 text-sky-800 ring-sky-200",
  bug: "bg-red-50 text-red-800 ring-red-200",
};

/** The Jira issue type, as a small labeled badge (ver_89). */
export function TypeBadge({ type, className }: { type: string; className?: string }) {
  return <span className={cx("inline-block rounded px-1.5 py-px text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", TYPE_TONE[type.toLowerCase()] ?? "bg-slate-50 text-slate-700 ring-slate-200", className)}>{type}</span>;
}

type PickCase = { id: string; key: string; title: string; folder: string };

/** The Requirements page list: one row per requirement, opened to see its cases and add more. An Epic that rolls up lists its child issues inside. */
export function StoryRows({ projectId, rows, canEdit, library }: { projectId: string; rows: CoverageRow[]; canEdit: boolean; library: PickCase[] }) {
  const [adding, setAdding] = useState<CoverageRow | null>(null);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface">
      <div className="hidden grid-cols-[minmax(0,1fr)_8rem_5rem_9rem_8rem] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 md:grid">
        <span>Requirement</span>
        <span>Jira status</span>
        <span>Cases</span>
        <span>Results</span>
        <span>Open bugs</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.story.key} className="border-b border-slate-100 last:border-0">
            <details className="group">
              <summary className="grid cursor-pointer list-none grid-cols-1 gap-1 px-3 py-2 text-sm hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_8rem_5rem_9rem_8rem] md:gap-3 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  {r.story.type && <TypeBadge type={r.story.type} />}
                  <span className="font-mono text-xs font-medium text-slate-700">{r.story.key}</span>
                  <span className={cx("truncate", r.story.missing && "text-orange-800")} title={r.story.title}>
                    {r.story.title || "…"}
                  </span>
                  {r.children && <span className="shrink-0 text-xs text-slate-500">Includes {r.children.length} child {r.children.length === 1 ? "issue" : "issues"}</span>}
                </span>
                <span className="text-xs text-slate-600">{r.story.status}</span>
                <span>{r.cases.length || <span className="text-slate-500">None</span>}</span>
                <Cell c={r.overall} />
                <span className="text-xs">{r.bugs.length ? r.bugs.map((b) => b.key).join(", ") : <span className="text-slate-500">None</span>}</span>
              </summary>
              <div className="space-y-2 bg-slate-50/60 px-3 pt-1 pb-3 pl-8 text-sm">
                {r.story.url && (
                  <a href={r.story.url} target="_blank" rel="noreferrer" className="text-xs text-accent-700 hover:underline">
                    Open {r.story.key} in Jira ↗
                  </a>
                )}
                {r.children && r.children.length > 0 && (
                  <ul className="space-y-1 rounded-md border border-slate-200 bg-surface p-2" aria-label={`Child issues of ${r.story.key}`}>
                    {r.children.map((k) => (
                      <li key={k.story.key} className="grid grid-cols-1 gap-1 text-sm md:grid-cols-[minmax(0,1fr)_8rem_5rem_9rem] md:gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          {k.story.type && <TypeBadge type={k.story.type} />}
                          {k.story.url ? (
                            <a href={k.story.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent-700 hover:underline">
                              {k.story.key}
                            </a>
                          ) : (
                            <span className="font-mono text-xs">{k.story.key}</span>
                          )}
                          <span className="truncate">{k.story.title}</span>
                        </span>
                        <span className="text-xs text-slate-600">{k.story.status}</span>
                        <span>{k.cases.length || <span className="text-slate-500">None</span>}</span>
                        <Cell c={k.overall} />
                      </li>
                    ))}
                  </ul>
                )}
                {r.cases.length ? (
                  <ul className="space-y-1">
                    {r.cases.map((c) => {
                      const last = c.results.find((s) => s);
                      return (
                        <li key={c.id} className="flex items-center gap-2">
                          <Link href={c.href} className="font-mono text-xs text-accent-700 hover:underline">
                            {c.key}
                          </Link>
                          <span className="min-w-0 flex-1 truncate">{c.title}</span>
                          {last ? <StatusChip status={last} /> : <span className="text-xs text-slate-500">Not run</span>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-slate-500">No cases test this {r.story.type ? r.story.type.toLowerCase() : "requirement"} yet.</p>
                )}
                {r.bugs.length > 0 && (
                  <p className="text-xs">
                    Open bugs:{" "}
                    {r.bugs.map((b, i) => (
                      <span key={b.key}>
                        {i > 0 && ", "}
                        {b.url ? (
                          <a href={b.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline" title={b.title}>
                            {b.key}
                          </a>
                        ) : (
                          <span title={b.title}>{b.key}</span>
                        )}
                      </span>
                    ))}
                  </p>
                )}
                {canEdit && (
                  <Button size="sm" onClick={() => setAdding(r)}>
                    Add cases
                  </Button>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {adding && <AddCases projectId={projectId} row={adding} library={library} onClose={() => setAdding(null)} />}
    </div>
  );
}

/** Start from a story: tick the cases that test it. */
function AddCases({ projectId, row, library, onClose }: { projectId: string; row: CoverageRow; library: PickCase[]; onClose: () => void }) {
  const router = useRouter();
  const has = new Set(row.cases.map((c) => c.id));
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const s = q.trim().toLowerCase();
  const list = library.filter((c) => !has.has(c.id) && (!s || c.key.toLowerCase().includes(s) || c.title.toLowerCase().includes(s) || c.folder.toLowerCase().includes(s)));
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const save = () =>
    start(async () => {
      const r = await linkStory(projectId, [...picked], row.story.key, "add");
      if (!r.ok) return setError(r.error);
      onClose();
      router.refresh();
    });
  return (
    <Modal open onClose={onClose} title={`Add cases to ${row.story.key}`}>
      <div className="space-y-3">
        {row.story.title && <p className="text-sm text-slate-600">{row.story.title}</p>}
        <Input autoFocus placeholder="Search by key, title or folder" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find cases" />
        <ul className="max-h-80 overflow-y-auto rounded-md border border-slate-200">
          {list.slice(0, 200).map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="font-mono text-xs text-slate-600">{c.key}</span>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                {c.folder && <span className="max-w-[40%] truncate text-xs text-slate-500">{c.folder}</span>}
              </label>
            </li>
          ))}
          {!list.length && <li className="px-2 py-3 text-center text-sm text-slate-500">No cases match.</li>}
          {list.length > 200 && <li className="px-2 py-1 text-xs text-slate-500">Showing 200 of {list.length}. Search to narrow it down.</li>}
        </ul>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked.size || pending} onClick={save}>
            {picked.size ? `Add ${picked.size} ${picked.size === 1 ? "case" : "cases"}` : "Add cases"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
