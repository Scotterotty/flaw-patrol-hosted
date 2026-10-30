"use client";

import { forgivingFilter } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "./close-matches";
import type { Priority } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveSuite } from "@/server/suites";
import { PriorityBadge } from "./badges";
import { CantFindCase, FolderList, inFolder, type ListFolder } from "./folder-list";
import { Button, Card, ErrorText, Field, InfoTip, Input, Select, Textarea } from "./ui";

export type PickCase = { id: string; number: number; key: string; title: string; folderId: string | null; folderPath: string; priority: Priority; tags: string[] };

export function SuiteEditor({
  projectId,
  projectKey,
  suiteId,
  initial,
  cases,
  folders,
  tags,
  archived,
  bracketTitles,
  umbrellaName,
  libraryKey,
}: {
  projectId: string;
  projectKey: string;
  suiteId: string | null;
  initial: { name: string; description: string; caseIds: string[] };
  cases: PickCase[];
  folders: (ListFolder & { label: string })[];
  tags: string[];
  archived: number;
  bracketTitles: number;
  umbrellaName: string | null;
  libraryKey: string;
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
  const inPicked = inFolder(folders, folder);
  // Forgiving search (ver_96): exact matches, then close ones under their own label.
  const found = forgivingFilter(
    cases.filter((c) => inPicked(c) && !(tag && !c.tags.includes(tag))),
    q,
    (c) => `${c.key} ${c.title} ${c.tags.join(" ")}`,
  );
  const visible = [...found.exact, ...found.close];
  const closeStart = found.close.length ? found.exact.length : -1;
  // Tick all takes the exact matches only, when there are some.
  const tickable = closeStart > 0 ? found.exact : visible;
  const allOn = tickable.length > 0 && tickable.every((c) => selectedSet.has(c.id));
  const folderName = folder ? (folders.find((f) => f.id === folder)?.name ?? "Not in a folder") : "All cases";
  // What's still needed before Create suite works (ver_99).
  const todo = [!name.trim() && "Name the suite", !selected.length && "Add at least one case"].filter(Boolean) as string[];

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
        <h1 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight">
          {suiteId ? "Edit suite" : "New test suite"}
          <InfoTip text="A saved list of cases you run together, like a smoke test." />
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {todo.length > 0 && (
            <span className="text-xs text-slate-500" data-testid="suite-todo">
              Still needed: {todo.join(", ").toLowerCase().replace(/^./, (x) => x.toUpperCase())}
            </span>
          )}
          <Button onClick={() => router.back()}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={pending || todo.length > 0}>
            {suiteId ? "Save suite" : "Create suite"}
          </Button>
        </div>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Card className="grid gap-4 p-5 md:grid-cols-2">
        <Field label="1. Name" htmlFor="suite-name">
          <Input id="suite-name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Checkout regression" autoFocus={!suiteId} />
        </Field>
        <Field label="Description (optional)" htmlFor="suite-desc">
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

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="flex min-h-0 flex-col">
          <div className="space-y-2 border-b border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-slate-800">
              2. Add cases <span className="font-normal text-slate-500">· tick the ones this suite runs</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <Input className="w-full sm:w-48" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" />
              <Select className="w-auto" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
                <option value="">Any tag</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            {bracketTitles > 0 && (
              <p className="rounded-md bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900" data-testid="bracket-hint">
                Looking for [UNITY] or [WEB]? Words in [brackets] at the start of a title aren&apos;t tags yet. Turn them into tags with <b>Review…</b> in the Case library.
              </p>
            )}
          </div>
          <div className="grid min-h-0 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <div className="border-b border-slate-200 sm:border-r sm:border-b-0">
              <FolderList folders={folders} cases={cases} value={folder} onChange={setFolder} />
            </div>
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
                <span className="min-w-0 truncate font-semibold text-slate-700">
                  {folderName} · {tickable.length} {tickable.length === 1 ? "case" : "cases"}
                </span>
                <Button
                  size="sm"
                  className="border-accent-500 text-accent-700 hover:bg-accent-50"
                  disabled={!tickable.length}
                  onClick={() => {
                    const ids = new Set(tickable.map((c) => c.id));
                    setSelected((s) => (allOn ? s.filter((id) => !ids.has(id)) : [...s, ...tickable.filter((c) => !s.includes(c.id)).map((c) => c.id)]));
                  }}
                >
                  {allOn ? "Untick all" : `Tick all ${tickable.length}`}
                </Button>
              </div>
              <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
                {visible.map((c, i) => (
                  <li key={c.id}>
                    {i === closeStart && (
                      <>
                        {closeStart === 0 && <p className="px-3 pt-1.5 text-xs text-slate-500">No exact matches.</p>}
                        <CloseMatchesLabel />
                      </>
                    )}
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
                {visible.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-slate-500">
                    {tag ? (
                      <>
                        No cases here have the tag {tag}.{" "}
                        <button type="button" className="font-medium text-accent-700 underline" onClick={() => setTag("")}>
                          Show all tags
                        </button>
                      </>
                    ) : (
                      "No cases match."
                    )}
                  </li>
                )}
              </ul>
            </div>
          </div>
          <CantFindCase archived={archived} bracketTitles={bracketTitles} umbrellaName={umbrellaName} libraryKey={libraryKey} />
        </Card>

        <Card className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-slate-800">
              3. In this suite ({selected.length}) <span className="font-normal text-slate-500">· runs in this order</span>
            </h2>
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
            {selected.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Ticked cases show up here. Use ↑ ↓ to change the order.</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}
