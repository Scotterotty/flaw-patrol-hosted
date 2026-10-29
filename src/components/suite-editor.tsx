"use client";

import type { Priority } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveSuite } from "@/server/suites";
import { PriorityBadge } from "./badges";
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from "./ui";

export type PickCase = { id: string; number: number; key: string; title: string; folderId: string | null; folderPath: string; priority: Priority; tags: string[] };

export function SuiteEditor({
  projectId,
  projectKey,
  suiteId,
  initial,
  cases,
  folders,
  tags,
}: {
  projectId: string;
  projectKey: string;
  suiteId: string | null;
  initial: { name: string; description: string; caseIds: string[] };
  cases: PickCase[];
  folders: { id: string; label: string; ids: string[] }[];
  tags: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [changeNote, setChangeNote] = useState("");
  const [selected, setSelected] = useState<string[]>(initial.caseIds);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
  const selectedSet = new Set(selected);
  const folderIds = folder ? new Set(folders.find((f) => f.id === folder)?.ids ?? []) : null;
  const visible = cases.filter((c) => {
    if (folderIds && !(c.folderId && folderIds.has(c.folderId))) return false;
    if (tag && !c.tags.includes(tag)) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!c.title.toLowerCase().includes(s) && !c.key.toLowerCase().includes(s)) return false;
    }
    return true;
  });
  const visibleUnselected = visible.filter((c) => !selectedSet.has(c.id));

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const move = (i: number, to: number) =>
    setSelected((s) => {
      if (to < 0 || to >= s.length) return s;
      const n = [...s];
      const [x] = n.splice(i, 1);
      n.splice(to, 0, x);
      return n;
    });

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveSuite(projectId, suiteId, { name, description, caseIds: selected, changeNote });
      if (!res.ok) return setError(res.error);
      router.push(`/p/${projectKey}/suites/${res.id}`);
      router.refresh();
    });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{suiteId ? "Edit suite" : "New test suite"}</h1>
        <div className="flex gap-2">
          <Button onClick={() => router.back()}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={pending || !name.trim()}>
            {suiteId ? "Save suite" : "Create suite"}
          </Button>
        </div>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Card className="grid gap-4 p-5 md:grid-cols-2">
        <Field label="Name" htmlFor="suite-name">
          <Input id="suite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Checkout regression" autoFocus={!suiteId} />
        </Field>
        <Field label="Description" htmlFor="suite-desc">
          <Textarea id="suite-desc" rows={1} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to run it" />
        </Field>
        {suiteId && (
          <div className="md:col-span-2">
            <Field label="What changed? (optional)" htmlFor="suite-note" hint="Changing the cases saves a new suite version. Past runs keep the version they ran.">
              <Input id="suite-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Added new payment cases for 2.5" />
            </Field>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="flex min-h-0 flex-col">
          <div className="space-y-2 border-b border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-slate-800">Add cases</h2>
            <div className="flex flex-wrap gap-2">
              <Input className="w-full sm:w-48" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" />
              <Select className="w-auto" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder">
                <option value="">All folders</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <Select className="w-auto" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
                <option value="">Any tag</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" disabled={!visibleUnselected.length} onClick={() => setSelected((s) => [...s, ...visibleUnselected.map((c) => c.id)])}>
              Add all {visibleUnselected.length} shown
            </Button>
          </div>
          <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
            {visible.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="mt-1" checked={selectedSet.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-slate-500">{c.key}</span> {c.title}
                    {c.folderPath && <span className="block text-xs text-slate-500">{c.folderPath}</span>}
                  </span>
                  <PriorityBadge priority={c.priority} />
                </label>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No cases match.</li>}
          </ul>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-slate-800">In this suite ({selected.length})</h2>
            {selected.length > 0 && (
              <button className="text-xs text-slate-500 hover:underline" onClick={() => setSelected([])}>
                Remove all
              </button>
            )}
          </div>
          <ol className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto">
            {selected.map((id, i) => {
              const c = byId.get(id);
              if (!c) return null;
              return (
                <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="w-6 text-right text-xs text-slate-400 tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-xs text-slate-500">{c.key}</span> {c.title}
                  </span>
                  <button aria-label="Move up" className="h-6 w-6 rounded text-slate-400 hover:bg-slate-100 disabled:invisible" disabled={i === 0} onClick={() => move(i, i - 1)}>
                    ↑
                  </button>
                  <button aria-label="Move down" className="h-6 w-6 rounded text-slate-400 hover:bg-slate-100 disabled:invisible" disabled={i === selected.length - 1} onClick={() => move(i, i + 1)}>
                    ↓
                  </button>
                  <button aria-label={`Remove ${c.key}`} className="h-6 w-6 rounded text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => toggle(id)}>
                    ×
                  </button>
                </li>
              );
            })}
            {selected.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Tick cases on the left to add them.</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}
