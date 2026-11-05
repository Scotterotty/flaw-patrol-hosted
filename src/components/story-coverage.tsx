"use client";

import { GlossaryText } from "./glossary";
import { forgivingFilter } from "@/lib/fuzzy";
import { CloseMatchesLabel } from "./close-matches";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { CoverageCell, CoverageRow } from "@/lib/story-coverage";
import { mightCover } from "@/lib/cover-match";
import { createCasesForStory, createCharterForStory } from "@/server/req-cases";
import { linkStory } from "@/server/stories";
import { StartExploringModal } from "./start-exploring";
import { StatusChip } from "./status";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, Input, Select } from "./ui";

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

/** The Jira issue type, as a small labeled badge. */
export function TypeBadge({ type, className }: { type: string; className?: string }) {
  return <span className={cx("inline-block rounded px-1.5 py-px text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", TYPE_TONE[type.toLowerCase()] ?? "bg-slate-50 text-slate-700 ring-slate-200", className)}>{type}</span>;
}

type PickCase = { id: string; key: string; title: string; folder: string };
type BoxTab = "new" | "charter" | "existing";

/** Back to this Requirements page as it is now (same release), with the requirement open and a note of what was made. */
function backTo(projectKey: string, storyKey: string, made: string) {
  const u = new URLSearchParams(window.location.search);
  u.set("open", storyKey);
  u.set("made", made);
  return `/p/${projectKey}/stories?${u}`;
}

/** The Requirements page list: one row per requirement, opened to see its cases and add more. An Epic that rolls up lists its child issues inside. */
export function StoryRows({
  projectId,
  projectKey,
  rows,
  canEdit,
  library,
  folders,
  openKey,
  flash,
}: {
  projectId: string;
  projectKey: string;
  rows: CoverageRow[];
  canEdit: boolean;
  library: PickCase[];
  folders: { id: string; label: string }[];
  /** Back from writing steps: the requirement to show opened, and what was made. */
  openKey?: string;
  flash?: string;
}) {
  const [adding, setAdding] = useState<{ row: CoverageRow; tab: BoxTab } | null>(null);
  const [note, setNote] = useState(flash ?? null);
  return (
    <>
    {note && (
      <p role="status" className="mb-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <span className="flex-1">✓ {note}</span>
        <button type="button" aria-label="Dismiss" className="text-emerald-700 hover:text-emerald-900" onClick={() => setNote(null)}>
          ×
        </button>
      </p>
    )}
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
            <details className="group" open={r.story.key === openKey || undefined}>
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
                          {c.charter && <span className="rounded bg-teal-50 px-1.5 py-px text-[11px] font-medium text-teal-800 ring-1 ring-teal-200 ring-inset">Charter</span>}
                          <span className="min-w-0 flex-1 truncate">{c.title}</span>
                          {c.needsSteps && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200 ring-inset" title="Made with a title only. Clears once the case has a step.">
                              Needs steps
                            </span>
                          )}
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
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="primary" onClick={() => setAdding({ row: r, tab: "new" })} data-howto="story-new-case">
                      + New case
                    </Button>
                    <Button size="sm" onClick={() => setAdding({ row: r, tab: "charter" })}>
                      + New charter
                    </Button>
                    <Button size="sm" onClick={() => setAdding({ row: r, tab: "existing" })} data-howto="story-add-existing">
                      Add existing cases
                    </Button>
                  </div>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {adding && <CasesBox projectId={projectId} projectKey={projectKey} row={adding.row} tab={adding.tab} library={library} folders={folders} onClose={() => setAdding(null)} />}
    </div>
    </>
  );
}

/** Folder picker for new cases and charters: any folder, or a new one named after the requirement. */
function FolderPick({ value, onChange, folders, storyKey }: { value: string; onChange: (v: string) => void; folders: { id: string; label: string }[]; storyKey: string }) {
  const exists = folders.find((f) => f.label === storyKey);
  return (
    <Field label="Folder" htmlFor="req-folder">
      <Select id="req-folder" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
        {!exists && <option value="new">+ New folder named &ldquo;{storyKey}&rdquo;</option>}
      </Select>
    </Field>
  );
}

function LinkedChip({ row }: { row: CoverageRow }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
      Linked to
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
        {row.story.type && <TypeBadge type={row.story.type} />}
        <span className="font-mono text-xs font-medium">{row.story.key}</span>
        <span className="truncate text-xs">{row.story.title}</span>
      </span>
    </p>
  );
}

/**
 * Cases for KEY: write new cases or a charter that come out linked to the
 * requirement, or tick existing ones. New cases opens first when nothing tests it yet.
 */
function CasesBox({ projectId, projectKey, row, tab: firstTab, library, folders, onClose }: { projectId: string; projectKey: string; row: CoverageRow; tab: BoxTab; library: PickCase[]; folders: { id: string; label: string }[]; onClose: () => void }) {
  const [tab, setTab] = useState<BoxTab>(firstTab);
  const [seed, setSeed] = useState<string | null>(null);
  // The folder the requirement's cases already live in, else none.
  const linkedFolders = new Set(library.filter((c) => row.cases.some((x) => x.id === c.id)).map((c) => c.folder));
  const usual = folders.find((f) => linkedFolders.has(f.label))?.id ?? folders.find((f) => f.label === row.story.key)?.id ?? "";
  const [folder, setFolder] = useState(usual);
  return (
    <Modal open onClose={onClose} title={`Cases for ${row.story.key}`} wide>
      <div className="space-y-3" data-testid="cases-box">
        {row.story.title && (
          <p className="text-sm text-slate-600" data-glossary-source={`Requirements · ${row.story.key}`}>
            <GlossaryText text={row.story.title} />
          </p>
        )}
        <div role="tablist" aria-label="Add" className="flex gap-1 border-b border-slate-200">
          {(
            [
              ["new", "New cases"],
              ["charter", "New charter"],
              ["existing", "Existing cases"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx("-mb-px border-b-2 px-3 py-1.5 text-sm", tab === id ? "border-accent-600 font-medium text-accent-800" : "border-transparent text-slate-600 hover:text-slate-900")}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "new" ? (
          <NewCases projectId={projectId} projectKey={projectKey} row={row} library={library} folders={folders} folder={folder} setFolder={setFolder} seed={seed} onClose={onClose} />
        ) : tab === "charter" ? (
          <NewCharter projectId={projectId} projectKey={projectKey} row={row} folders={folders} folder={folder} setFolder={setFolder} onClose={onClose} />
        ) : (
          <ExistingCases
            projectId={projectId}
            row={row}
            library={library}
            onClose={onClose}
            onNew={(title) => {
              setSeed(title);
              setTab("new");
            }}
          />
        )}
      </div>
    </Modal>
  );
}

function NewCases({
  projectId,
  projectKey,
  row,
  library,
  folders,
  folder,
  setFolder,
  seed,
  onClose,
}: {
  projectId: string;
  projectKey: string;
  row: CoverageRow;
  library: PickCase[];
  folders: { id: string; label: string }[];
  folder: string;
  setFolder: (v: string) => void;
  seed: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const has = new Set(row.cases.map((c) => c.id));
  // Title 1 starts as the Jira title; it's fully editable.
  const [titles, setTitles] = useState<string[]>(() => (seed ? [seed] : [row.story.title || ""]));
  const [linked, setLinked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const focusAt = useRef<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  // The dialog focuses its first button on open; start in title 1 instead, cursor at the end.
  useEffect(() => {
    const t = setTimeout(() => {
      const first = list.current?.querySelector("input");
      first?.focus();
      first?.setSelectionRange(first.value.length, first.value.length);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (focusAt.current === null) return;
    list.current?.querySelectorAll("input")[focusAt.current]?.focus();
    focusAt.current = null;
  });
  const others = library.filter((c) => !has.has(c.id));
  const count = titles.filter((t) => t.trim()).length;
  const setAt = (i: number, v: string) => setTitles((l) => l.map((t, j) => (j === i ? v : t)));
  const create = (write: boolean) =>
    start(async () => {
      setError(null);
      const r = await createCasesForStory(projectId, row.story.key, { titles, folder: folder || null });
      if (!r.ok) return setError(r.error);
      const [first, ...rest] = r.numbers;
      if (write) {
        router.push(`/p/${projectKey}/cases/${first}/edit?${new URLSearchParams({ req: row.story.key, queue: rest.join(","), at: "1", total: String(r.numbers.length), back: backTo(projectKey, row.story.key, String(r.numbers.length)) })}`);
        return;
      }
      onClose();
      router.push(backTo(projectKey, row.story.key, String(r.numbers.length)));
      router.refresh();
    });
  const linkInstead = (i: number, c: PickCase) =>
    start(async () => {
      const r = await linkStory(projectId, [c.id], row.story.key, "add");
      if (!r.ok) return setError(r.error);
      setLinked((l) => [...l, c.key]);
      setTitles((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [""]));
      router.refresh();
    });
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium text-slate-700">Titles, one case each</p>
      <ol ref={list} className="space-y-2">
        {titles.map((t, i) => {
          const dup = t.trim() ? mightCover(t, others, { strict: true, limit: 1 })[0]?.c : undefined;
          return (
            <li key={i}>
              <div className="flex items-center gap-2">
                <span className="w-5 text-right text-xs text-slate-500">{i + 1}</span>
                <Input
                  aria-label={`Title ${i + 1}`}
                  value={t}
                  maxLength={500}
                  autoFocus={i === 0}
                  onChange={(e) => setAt(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    focusAt.current = i + 1;
                    setTitles((l) => [...l.slice(0, i + 1), "", ...l.slice(i + 1)]);
                  }}
                  onPaste={(e) => {
                    const lines = e.clipboardData
                      .getData("text")
                      .split(/\r?\n/)
                      .map((x) => x.trim())
                      .filter(Boolean);
                    if (lines.length < 2) return;
                    // Several lines make one row each.
                    e.preventDefault();
                    setTitles((l) => [...l.slice(0, i), ...(l[i].trim() ? [l[i], ...lines] : lines), ...l.slice(i + 1)].slice(0, 50));
                  }}
                />
                <button type="button" aria-label={`Remove title ${i + 1}`} className="px-1 text-slate-400 hover:text-slate-700" onClick={() => setTitles((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [""]))}>
                  ×
                </button>
              </div>
              {dup && (
                <p className="mt-1 ml-7 text-xs text-amber-800">
                  Looks like <span className="font-mono">{dup.key}</span> &ldquo;{dup.title}&rdquo; may cover this.{" "}
                  <button type="button" className="font-medium text-accent-700 hover:underline" disabled={pending} onClick={() => linkInstead(i, dup)}>
                    Link that one instead
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-slate-500">Title 1 comes from Jira. Edit it or type over it. Press Enter for a new row. Pasting several lines makes one row per line.</p>
      {linked.length > 0 && <p className="text-xs text-emerald-800">✓ Linked {linked.join(", ")} instead.</p>}
      <FolderPick value={folder} onChange={setFolder} folders={folders} storyKey={row.story.key} />
      <LinkedChip row={row} />
      <p className="text-xs text-slate-500">Priority, tags and type use your usual defaults. Change them in the editor any time.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={!count || pending} onClick={() => create(false)} title="Saves them with titles only and marks them Needs steps.">
          {count > 1 ? `Create ${count} cases` : "Create case"}
        </Button>
        <Button variant="primary" disabled={!count || pending} onClick={() => create(true)} title="Saves them all and opens the first in the case editor.">
          {pending ? "Creating…" : "Create and write steps"}
        </Button>
      </div>
    </div>
  );
}

function NewCharter({ projectId, projectKey, row, folders, folder, setFolder, onClose }: { projectId: string; projectKey: string; row: CoverageRow; folders: { id: string; label: string }[]; folder: string; setFolder: (v: string) => void; onClose: () => void }) {
  const router = useRouter();
  const [explore, setExplore] = useState(row.story.title);
  const [withWhat, setWith] = useState("");
  const [discover, setDiscover] = useState(`whether ${row.story.key} does what it promises, and what breaks or confuses people`);
  const [minutes, setMinutes] = useState(30);
  const [exploring, setExploring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const create = (go: boolean) =>
    start(async () => {
      setError(null);
      const r = await createCharterForStory(projectId, row.story.key, { explore, with: withWhat, discover, minutes, folder: folder || null });
      if (!r.ok) return setError(r.error);
      router.refresh();
      if (go) return setExploring(r.caseId);
      onClose();
      router.push(backTo(projectKey, row.story.key, "charter"));
    });
  if (exploring) return <StartExploringModal caseId={exploring} open onClose={onClose} />;
  return (
    <div className="space-y-3 text-sm">
      <Field label="Explore" htmlFor="ch-explore">
        <Input id="ch-explore" value={explore} onChange={(e) => setExplore(e.target.value)} maxLength={2000} autoFocus />
      </Field>
      <Field label="With (optional)" htmlFor="ch-with">
        <Input id="ch-with" value={withWhat} onChange={(e) => setWith(e.target.value)} maxLength={2000} placeholder="Like two browsers, a slow network, a new account" />
      </Field>
      <Field label="To discover" htmlFor="ch-discover">
        <Input id="ch-discover" value={discover} onChange={(e) => setDiscover(e.target.value)} maxLength={2000} />
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Length</legend>
        <div className="flex flex-wrap gap-2">
          {[15, 30, 60, 90].map((m) => (
            <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)} className={cx("rounded-full border px-3 py-1", minutes === m ? "border-accent-500 bg-accent-50 font-medium text-accent-800" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
              {m} min
            </button>
          ))}
        </div>
      </fieldset>
      <FolderPick value={folder} onChange={setFolder} folders={folders} storyKey={row.story.key} />
      <LinkedChip row={row} />
      <Link href={`/p/${projectKey}/charters/new?story=${encodeURIComponent(row.story.key)}`} className="inline-block text-sm text-accent-700 hover:underline">
        Start from a tour or checklist instead…
      </Link>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={!explore.trim() || pending} onClick={() => create(false)}>
          Create charter
        </Button>
        <Button variant="primary" disabled={!explore.trim() || pending} onClick={() => create(true)}>
          {pending ? "Creating…" : "Create and start exploring"}
        </Button>
      </div>
    </div>
  );
}

/** Existing cases: tick the cases that test it. Related-looking ones come first. */
function ExistingCases({ projectId, row, library, onClose, onNew }: { projectId: string; row: CoverageRow; library: PickCase[]; onClose: () => void; onNew: (title: string) => void }) {
  const router = useRouter();
  const has = new Set(row.cases.map((c) => c.id));
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const others = library.filter((c) => !has.has(c.id));
  // Forgiving search: exact matches, then close ones under their own label.
  const found = forgivingFilter(others, q, (c) => `${c.key} ${c.title} ${c.folder}`);
  const list = [...found.exact, ...found.close];
  const closeStart = found.close.length ? found.exact.length : -1;
  // Might already cover this: words shared with the Jira title, or the folder its cases live in.
  const linkedFolders = new Set(library.filter((c) => has.has(c.id)).map((c) => c.folder).filter(Boolean));
  const byWords = mightCover(row.story.title, others).map((m) => ({ c: m.c, why: `${m.words.length} words match the Jira title` }));
  const byFolder = others.filter((c) => linkedFolders.has(c.folder) && !byWords.some((w) => w.c.id === c.id)).slice(0, 3 - Math.min(3, byWords.length)).map((c) => ({ c, why: `same folder as ${row.story.key}'s cases` }));
  const suggest = q ? [] : [...byWords, ...byFolder];
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
  const rowOf = (c: PickCase, why?: string) => (
    <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-50">
      <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
      <span className="font-mono text-xs text-slate-600">{c.key}</span>
      <span className="min-w-0 flex-1 truncate">{c.title}</span>
      {why ? <span className="max-w-[40%] truncate text-xs text-slate-500">{why}</span> : c.folder && <span className="max-w-[40%] truncate text-xs text-slate-500">{c.folder}</span>}
    </label>
  );
  return (
    <div className="space-y-3">
      {suggest.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60" data-testid="might-cover">
          <p className="px-2 pt-1.5 text-xs font-semibold text-amber-900">Might already cover this</p>
          <ul>
            {suggest.map(({ c, why }) => (
              <li key={c.id}>{rowOf(c, why)}</li>
            ))}
          </ul>
        </div>
      )}
      <Input autoFocus placeholder="Search by key, title or folder" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find cases" />
      <ul className="max-h-80 overflow-y-auto rounded-md border border-slate-200">
        {list.slice(0, 200).map((c, i) => (
          <li key={c.id}>
            {i === closeStart && (
              <>
                {closeStart === 0 && <p className="px-2 pt-1.5 text-xs text-slate-500">No exact matches.</p>}
                <CloseMatchesLabel className="px-2" />
              </>
            )}
            {rowOf(c)}
          </li>
        ))}
        {!list.length && <li className="px-2 py-3 text-center text-sm text-slate-500">No cases match{q && <> &ldquo;{q}&rdquo;</>}.</li>}
        {q.trim() && !found.exact.length && (
          <li className="border-t border-slate-100 px-2 py-2">
            <button type="button" className="text-sm font-medium text-accent-700 hover:underline" onClick={() => onNew(q.trim())}>
              + New case &ldquo;{q.trim()}&rdquo;
            </button>
          </li>
        )}
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
  );
}
