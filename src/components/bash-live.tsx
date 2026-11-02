"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { Severity } from "@prisma/client";
import { cleanPlatforms, LINK_KIND_LABEL, seenOn, similarBugs, type BashLink } from "@/lib/bash";
import type { BashFinds, LiveFind } from "@/lib/bash-live";
import { addToBashItem, deleteBashItem, editBashItem, fillBashItem, plusOneBash, searchBashLinks, setBashLinks } from "@/server/bashes";
import { listWords } from "@/lib/bug-layout";
import type { BashValues } from "@/lib/bash-template";
import { SevChip, useBashUpload } from "./bash";
import { AnswerTables, NeedsTag, seenHere, TemplateFields } from "./bash-template";
import { Button, cx, ErrorText } from "./ui";

// Live finds: the panel on Log a bug that fills in as people log, so nobody logs the
// same thing twice. A find you open stays put: new finds from others wait behind a bar
// until you show them or close it.

export type LiveData = Omit<BashFinds, "projectId">;
export type FindKind = LiveFind["kind"];
export const FIND_LABEL: Record<FindKind, string> = { bug: "Bug", question: "Question", note: "Note", idea: "Idea" };
const KIND_TONE: Record<FindKind, string> = {
  bug: "bg-red-50 text-red-800 ring-red-200",
  question: "bg-sky-50 text-sky-800 ring-sky-200",
  note: "bg-slate-100 text-slate-700 ring-slate-200",
  idea: "bg-violet-50 text-violet-800 ring-violet-200",
};

export function KindTag({ kind, className }: { kind: FindKind; className?: string }) {
  return <span className={cx("inline-block w-[4.5rem] shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold ring-1 ring-inset", KIND_TONE[kind], className)}>{FIND_LABEL[kind]}</span>;
}

/** Polls the bash's finds every 2 seconds, while the tab is in view. `reload` asks right away. */
export function useLiveFinds(bashId: string, initial: LiveData) {
  const [data, setData] = useState(initial);
  const busy = useRef(false);
  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch(`/api/live/bashes/${bashId}/finds`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as LiveData);
    } catch {
      // The next tick tries again.
    } finally {
      busy.current = false;
    }
  }, [bashId]);
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) void reload();
    }, 2000);
    return () => clearInterval(t);
  }, [reload]);
  return { data, reload };
}

const ago = (iso: string, now: number) => {
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : `${m} min ago`;
};

type Scope = "area" | "all" | "mine";

/**
 * The panel. `draft` is what's typed in Log a bug: finds that look like it float up, amber.
 * `openId` is lifted so Log a bug's "Open it" can open a look-alike here.
 */
/** Platforms people +1'd a find on, besides the one it was logged on. */
const alsoOn = (i: { platform: string; plusOnes: { platform: string }[] }) => seenOn(i).filter((p) => p.toLowerCase() !== i.platform.toLowerCase());

export function LiveFinds({
  bashId,
  data,
  reload,
  meId,
  areaId,
  draft,
  openId,
  setOpenId,
  live,
  projectId,
}: {
  projectId: string;
  bashId: string;
  data: LiveData;
  reload: () => Promise<void>;
  meId: string;
  areaId: string;
  draft: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  live: boolean;
}) {
  const [scope, setScope] = useState<Scope>("area");
  const [kind, setKind] = useState<"all" | FindKind>("all");
  // Platform filter (ver_146): offered once any find has a platform. "" shows every platform.
  const [plat, setPlat] = useState("");
  const platformsSeen = cleanPlatforms(data.items.flatMap((i) => seenOn(i)));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Half-typed additions, by find: kept in state here, so refreshes never touch them.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // What's being typed to fill in a bug's missing headings, by find.
  const [filling, setFilling] = useState<Record<string, BashValues>>({});
  const [shots, setShots] = useState<Record<string, { id: string; fileName: string }[]>>({});
  const upload = useBashUpload(projectId, bashId, setError);
  const [now, setNow] = useState(() => Date.now());
  const [folded, setFolded] = useState(true);
  const list = useRef<HTMLUListElement>(null);
  // When each find first showed up here, for the New tag and glow (30 seconds).
  const firstSeen = useRef<Map<string, number> | null>(null);
  if (firstSeen.current === null) firstSeen.current = new Map(data.items.map((i) => [i.id, 0]));
  for (const i of data.items) if (!firstSeen.current.has(i.id)) firstSeen.current.set(i.id, Date.now());
  // Finds that were showing when one was opened; later ones from others wait (hold while open).
  const [shownAt, setShownAt] = useState<Set<string> | null>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const [newSince, setNewSince] = useState(0);
  // After Add to it / Answer: the find closes, a green line says it worked, the row glows.
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 6000);
    return () => clearTimeout(t);
  }, [done]);
  const lastCount = useRef(data.items.length);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // Open a find: snapshot what's showing, and in what order, so nothing moves. Close it: catch up.
  const order = useRef<string[] | null>(null);
  const shownRef = useRef<string[]>([]);
  if (openId && !order.current) order.current = shownRef.current;
  if (!openId) order.current = null;
  useEffect(() => {
    if (openId) setShownAt((s) => s ?? new Set(data.items.map((i) => i.id)));
    else setShownAt(null);
    // Only when the open find changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  // Open it (from Log a bug's look-alike note) on a find this view hides: widen the view to show it.
  useEffect(() => {
    const it = openId ? data.items.find((i) => i.id === openId) : null;
    if (!it) return;
    if (scope === "area" && it.areaId !== areaId) setScope("all");
    if (scope === "mine" && it.byId !== meId) setScope("all");
    if (kind !== "all" && it.kind !== kind) setKind("all");
    if (plat && !seenOn(it).some((p) => p.toLowerCase() === plat.toLowerCase())) setPlat("");
    setFolded(false);
    // Only when a different find opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const inScope = data.items.filter((i) => (scope === "all" || (scope === "area" ? i.areaId === areaId : i.byId === meId)) && (kind === "all" || i.kind === kind) && (!plat || seenOn(i).some((p) => p.toLowerCase() === plat.toLowerCase())));
  const held = shownAt ? inScope.filter((i) => !shownAt.has(i.id) && i.byId !== meId) : [];
  const visible = inScope.filter((i) => !held.includes(i));
  // Look-alikes of what's being typed float up, but never while a find is open (it would move).
  const alike = openId || draft.trim().length < 6 ? [] : similarBugs(draft, visible.filter((i) => i.byId !== meId));
  const sorted = [...alike, ...visible.filter((i) => !alike.includes(i))];
  // While a find is open the order is frozen; finds let in with Show go on top.
  const frozen = order.current;
  const shown = frozen ? [...sorted.filter((i) => !frozen.includes(i.id)), ...frozen.flatMap((id) => sorted.filter((i) => i.id === id))] : sorted;
  if (!openId) shownRef.current = shown.map((i) => i.id);
  const fresh = (id: string) => {
    const t = firstSeen.current!.get(id) ?? 0;
    return t > 0 && now - t < 30_000;
  };

  // "N new ↑" when finds arrive while scrolled down.
  useEffect(() => {
    const n = data.items.length;
    if (n > lastCount.current && (list.current?.scrollTop ?? 0) > 20) setNewSince((c) => c + n - lastCount.current);
    lastCount.current = n;
  }, [data.items.length]);

  // Show waiting finds with the open row kept at the same spot on screen.
  const showHeld = () => {
    const row = openId ? list.current?.querySelector<HTMLElement>(`[data-row="${openId}"]`) : null;
    if (row && list.current) anchor.current = { id: openId!, top: row.offsetTop - list.current.scrollTop };
    setShownAt(new Set(data.items.map((i) => i.id)));
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || !list.current) return;
    const row = list.current.querySelector<HTMLElement>(`[data-row="${a.id}"]`);
    if (row) list.current.scrollTop = row.offsetTop - a.top;
    anchor.current = null;
  });

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "That didn't work.");
      after?.();
      await reload();
    });

  const paused = !!openId;
  const newCount = data.items.filter((i) => fresh(i.id) && i.byId !== meId).length;
  const myArea = data.areas.find((a) => a.id === areaId);
  return (
    <section aria-label="Live finds" className="rounded-lg border border-slate-200 bg-surface shadow-sm lg:sticky lg:top-16" data-testid="live-finds">
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-slate-800 lg:hidden" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
        <span>
          Live finds{newCount > 0 && <span className="ml-1 font-normal text-accent-700">· {newCount} new</span>}
        </span>
        <span aria-hidden>{folded ? "▸" : "▾"}</span>
      </button>
      <div className={cx(folded && "hidden", "lg:block")}>
        <div className="space-y-2 border-b border-slate-100 px-3 pt-3 pb-2">
          <p className="hidden items-center gap-2 text-sm font-semibold text-slate-800 lg:flex">
            Live finds
            <span
              className={cx("inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-semibold", paused ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700")}
              title={paused ? "New finds wait while you have one open, so it doesn't move. Close it to catch up." : "Fills in as people log."}
              data-testid="live-state"
            >
              <span aria-hidden className={cx("size-1.5 rounded-full", paused ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
              {paused ? "Paused" : live ? "Live" : "Ended"}
            </span>
            <span className="ml-auto text-xs font-normal text-slate-500">{shown.length} shown</span>
          </p>
          <div role="group" aria-label="Whose finds" className="grid grid-cols-3 rounded-md bg-slate-100 p-0.5 text-xs">
            {(
              [
                ["area", "My area", myArea?.name],
                ["all", "All areas", undefined],
                ["mine", "Just mine", undefined],
              ] as const
            ).map(([id, label, tip]) => (
              <button key={id} type="button" title={tip} aria-pressed={scope === id} onClick={() => setScope(id)} className={cx("rounded px-1.5 py-1", scope === id ? "bg-surface font-semibold text-slate-900 shadow-sm" : "text-slate-600")}>
                {label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Kind" className="flex flex-wrap gap-1">
            {(["all", "bug", "question", "note", "idea"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cx("rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset", kind === k ? "bg-slate-800 font-semibold text-slate-50 ring-slate-800" : "text-slate-600 ring-slate-200 hover:bg-slate-50")}>
                {k === "all" ? "All" : `${FIND_LABEL[k]}s`}
              </button>
            ))}
            {platformsSeen.length > 0 && (
              <select aria-label="Show platform" className="ml-auto h-6 rounded border border-slate-300 bg-surface px-1 text-[11px] text-slate-700" value={plat} onChange={(e) => setPlat(e.target.value)}>
                <option value="">All platforms</option>
                {platformsSeen.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="relative">
          {(held.length > 0 || newSince > 0) && (
            // Over the list, not in it: showing the bar never shifts the rows.
            <button
              type="button"
              className="absolute inset-x-3 top-1.5 z-10 rounded-full bg-accent-600 px-2 py-1 text-xs font-semibold text-white shadow-lg hover:bg-accent-700"
              onClick={() => {
                if (held.length) showHeld();
                else {
                  list.current?.scrollTo({ top: 0, behavior: "smooth" });
                  setNewSince(0);
                }
              }}
              data-testid="finds-waiting"
            >
              {held.length ? `${held.length} new ${held.length === 1 ? "find" : "finds"} waiting · Show` : `${newSince} new ↑`}
            </button>
          )}
          {done && (
            <p role="status" className="border-b border-slate-100 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800" data-testid="find-done">
              {done.text}
            </p>
          )}
          <ul
            ref={list}
            className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto"
            onScroll={(e) => {
              if (e.currentTarget.scrollTop <= 20 && newSince) setNewSince(0);
            }}
          >
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Nothing here yet. New finds show up as people log them.</li>}
            {shown.map((i) => {
              const open = openId === i.id;
              const mine = i.byId === meId;
              const iPlus = i.plusOnes.some((p) => p.id === meId);
              const isAlike = alike.includes(i);
              const area = data.areas.find((a) => a.id === i.areaId)?.name ?? "";
              return (
                <li key={i.id} data-row={i.id} className={cx("px-3 py-2 text-sm transition-colors duration-[2000ms]", isAlike ? "bg-amber-50" : done?.id === i.id ? "bg-emerald-50" : fresh(i.id) ? "bg-accent-50" : open ? "bg-slate-50" : "")}>
                  <button type="button" className="flex w-full items-start gap-2 text-left" aria-expanded={open} onClick={() => {
                      setDone(null);
                      setOpenId(open ? null : i.id);
                    }}>
                    <KindTag kind={i.kind} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-900">
                        {fresh(i.id) && !mine && <span className="mr-1 rounded bg-accent-600 px-1 py-px text-[10px] font-semibold text-white uppercase">New</span>}
                        {isAlike && <span className="mr-1 rounded bg-amber-200 px-1 py-px text-[10px] font-semibold text-amber-900">Looks like yours</span>}
                        {i.text}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                        <b className="font-medium text-slate-700">{mine ? "You" : i.byName}</b>
                        <span>{ago(i.at, now)}</span>
                        {scope !== "area" && <span>· {area}</span>}
                        {i.kind === "bug" && <SevChip s={i.severity as Severity} />}
                        {!i.bug && <NeedsTag t={i.template} />}
                        {i.platform && <span className="rounded bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600">{i.platform}</span>}
                        {i.plusOnes.length > 0 && <span title={i.plusOnes.map((p) => `${p.name}${p.platform ? ` on ${p.platform}` : ""}`).join(", ")}>+{i.plusOnes.length}</span>}
                        {alsoOn(i).length > 0 && <span>· Seen on {alsoOn(i).join(", ")}{i.platform ? " too" : ""}</span>}
                        {i.kind === "question" ? i.adds.length > 0 && <span className="font-semibold text-emerald-700">Answered</span> : i.adds.length > 0 && <span>{i.adds.length} added</span>}
                        {i.bug && <span className="font-mono text-red-700">{i.bug.key}</span>}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <div className="mt-2 space-y-2 border-l-2 border-accent-200 pl-2" data-testid="find-open">
                      {i.details && <p className="text-xs whitespace-pre-wrap text-slate-600">{i.details}</p>}
                      {i.template && <p className="text-[11px] text-slate-500">{i.template.name}</p>}
                      {i.template && !i.bug && i.template.needs.length > 0 && live && (
                        <div className="space-y-2 rounded-md bg-amber-50 p-2 ring-1 ring-amber-200 ring-inset" data-testid="find-needs">
                          <p className="text-xs text-amber-900">
                            Still needed before it&apos;s filed: <b className="font-semibold">{listWords(i.template.needs)}</b>. Anyone can add {i.template.needs.length === 1 ? "it" : "them"}.
                          </p>
                          <TemplateFields layout={i.template.layout} values={filling[i.id] ?? {}} setValues={(fn) => setFilling((f) => ({ ...f, [i.id]: fn(f[i.id] ?? {}) }))} only={i.template.needIds} upload={upload} idPrefix={`fill-${i.id}`} />
                          {i.template.shot && (
                            <p className="flex flex-wrap items-center gap-1.5 text-xs">
                              <label className="cursor-pointer rounded-md px-2 py-1 font-medium text-accent-700 ring-1 ring-slate-300 hover:bg-white">
                                Add a screenshot or video
                                <input
                                  type="file"
                                  hidden
                                  accept="image/*,video/*"
                                  onChange={async (e) => {
                                    const l = [...(e.target.files ?? [])];
                                    e.target.value = "";
                                    const up = await upload(l);
                                    setShots((x) => ({ ...x, [i.id]: [...(x[i.id] ?? []), ...up] }));
                                  }}
                                />
                              </label>
                              {(shots[i.id] ?? []).map((f) => (
                                <span key={f.id} className="rounded bg-white px-1.5 py-0.5 text-slate-700">
                                  {f.fileName}
                                </span>
                              ))}
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={pending}
                            onClick={() =>
                              act(
                                () => fillBashItem(i.id, { values: filling[i.id] ?? {}, attachmentIds: (shots[i.id] ?? []).map((f) => f.id) }),
                                () => {
                                  setFilling((f) => ({ ...f, [i.id]: {} }));
                                  setShots((x) => ({ ...x, [i.id]: [] }));
                                },
                              )
                            }
                          >
                            Add
                          </Button>
                        </div>
                      )}
                      {i.template && <AnswerTables answers={i.template.answers} />}
                      {i.attachments.length > 0 && (
                        <p className="flex flex-wrap gap-1 text-xs">
                          {i.attachments.map((a) => (
                            <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 hover:underline">
                              {a.fileName}
                            </a>
                          ))}
                        </p>
                      )}
                      {i.adds.length ? (
                        <ul className="space-y-1 text-xs">
                          {i.adds.map((a) => (
                            <li key={a.id} className="rounded bg-slate-50 px-2 py-1 text-slate-700">
                              <b className="font-medium">{a.byId === meId ? "You" : a.byName}:</b> {a.text}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500">Nothing added yet.</p>
                      )}
                      {editing?.id === i.id ? (
                        <div className="flex gap-1.5">
                          <input aria-label="Change your find" className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-surface px-2 text-sm" value={editing.text} maxLength={300} onChange={(e) => setEditing({ id: i.id, text: e.target.value })} />
                          <Button size="sm" variant="primary" disabled={pending || !editing.text.trim()} onClick={() => act(() => editBashItem(i.id, { text: editing.text }), () => setEditing(null))}>
                            Save
                          </Button>
                          <Button size="sm" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {!mine && i.kind !== "question" && live && (
                            <Button size="sm" variant={iPlus ? "secondary" : "primary"} disabled={pending} onClick={() => act(() => plusOneBash(i.id, !iPlus, seenHere()))}>
                              {iPlus ? "✓ You see it too" : i.kind === "bug" ? "+1, I see it too" : "+1"}
                            </Button>
                          )}
                          {mine && live && !i.bug && (
                            <>
                              <Button size="sm" onClick={() => setEditing({ id: i.id, text: i.text })}>
                                Edit
                              </Button>
                              <Button size="sm" disabled={pending} onClick={() => act(() => deleteBashItem(i.id), () => setOpenId(null))}>
                                Remove
                              </Button>
                            </>
                          )}
                          <Button size="sm" className="ml-auto" onClick={() => setOpenId(null)}>
                            Close
                          </Button>
                        </div>
                      )}
                      {live && (
                        <form
                          className="flex gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const text = typed[i.id]?.trim();
                            if (!text) return;
                            act(
                              () => addToBashItem(i.id, text),
                              () => {
                                setTyped((t) => ({ ...t, [i.id]: "" }));
                                setOpenId(null);
                                setDone({ id: i.id, text: i.kind === "question" ? `Answered "${i.text}". Everyone sees it.` : `Added to "${i.text}". Everyone sees it.` });
                              },
                            );
                          }}
                        >
                          <input
                            aria-label={i.kind === "question" ? "Your answer" : "Add to it"}
                            className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-surface px-2 text-sm focus:border-accent-500 focus:outline-none"
                            placeholder={i.kind === "question" ? "Your answer" : "Add a detail, like Also on Safari"}
                            value={typed[i.id] ?? ""}
                            maxLength={1000}
                            onChange={(e) => setTyped((t) => ({ ...t, [i.id]: e.target.value }))}
                          />
                          <Button size="sm" type="submit" disabled={pending || !typed[i.id]?.trim()}>
                            {i.kind === "question" ? "Answer" : "Add to it"}
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">Everyone in this bash sees what you log, including notes and questions.</p>
      </div>
    </section>
  );
}

/** A link chip: what it is (Jira, GitHub PR, Web page), its key or name, then the title. */
export function LinkRow({ l, onRemove }: { l: BashLink; onRemove?: () => void }) {
  const body = (
    <>
      <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[10px] font-semibold text-slate-600">{LINK_KIND_LABEL[l.kind]}</span>
      <span className="min-w-0 flex-1 truncate">
        <b className="font-medium text-slate-900">{l.key}</b> {l.title}
      </span>
      {l.state && !onRemove && <span className="shrink-0 text-[11px] text-slate-500">{l.state}</span>}
    </>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs">
      {l.url ? (
        <a href={l.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 hover:underline">
          {body}
          {!onRemove && <span aria-hidden>↗</span>}
        </a>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{body}</span>
      )}
      {onRemove && (
        <button type="button" aria-label={`Remove ${l.key}`} className="px-1 text-slate-400 hover:text-slate-700" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

/** Small link chips for area names on the join cards, board and report. */
export function LinkChips({ links }: { links: BashLink[] }) {
  if (!links.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {links.map((l) => (
        <a key={`${l.kind}${l.key}`} href={l.url || undefined} target="_blank" rel="noreferrer" title={`${LINK_KIND_LABEL[l.kind]}: ${l.title}`} className="rounded bg-slate-100 px-1.5 py-px text-[11px] font-normal text-slate-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          <b className="font-semibold">{l.key}</b> {LINK_KIND_LABEL[l.kind]}
        </a>
      ))}
    </span>
  );
}

/** + Add: a Jira key or words, a GitHub PR, or any web address. */
export function AddLink({ bashId, onPick }: { bashId: string; onPick: (l: BashLink) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<BashLink[] | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    const text = q.trim();
    if (!text) return setFound(null);
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchBashLinks(bashId, text);
      if (!live) return;
      if (r.ok) {
        setFound(r.links);
        setNote(r.note);
      } else setNote(r.error);
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, bashId]);
  return (
    <div className="relative">
      <input aria-label="Add a link" className="h-8 w-full rounded-md border border-slate-300 bg-surface px-2 text-xs" placeholder="+ Add: Jira key, GitHub PR, or paste any web address" value={q} onChange={(e) => setQ(e.target.value)} />
      {found && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-surface p-1 shadow-lg">
          {found.map((l) => (
            <li key={`${l.kind}${l.key}${l.url}`}>
              <button
                type="button"
                className="w-full rounded px-1.5 py-1 text-left hover:bg-slate-50"
                onClick={() => {
                  onPick(l);
                  setQ("");
                  setFound(null);
                }}
              >
                <LinkRow l={{ ...l, url: "" }} />
              </button>
            </li>
          ))}
          {!found.length && <li className="px-1.5 py-1 text-xs text-slate-500">Nothing found. Paste a web address to link any page.</li>}
          {note && <li className="px-1.5 py-1 text-[11px] text-amber-800">{note}</li>}
        </ul>
      )}
    </div>
  );
}

/**
 * What you're testing: the area's links and the whole bash's. Whoever started it can
 * edit them, here or on the board (which lists every area).
 */
export function WhatYoureTesting({
  bashId,
  groups,
  canEdit,
  onSaved,
  title = "What you're testing",
}: {
  bashId: string;
  groups: { title: string; areaId: string | null; links: BashLink[] }[];
  canEdit: boolean;
  onSaved: () => void;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (which: string | null, links: BashLink[]) =>
    start(async () => {
      setError(null);
      const r = await setBashLinks(bashId, which, links);
      if (!r.ok) return setError(r.error);
      onSaved();
    });
  return (
    <div className="space-y-2" data-testid="what-youre-testing">
      <p className="flex items-center justify-between text-xs font-semibold text-slate-700">
        {title}
        {canEdit && (
          <button type="button" className="font-medium text-accent-700 hover:underline" onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {groups.map((g) => (
        <div key={g.areaId ?? "bash"} className="space-y-1">
          {g.title && <p className="text-[11px] font-semibold text-slate-500 uppercase">{g.title}</p>}
          {g.links.map((l, i) => (
            <LinkRow key={`${l.kind}${l.key}${i}`} l={l} onRemove={editing ? () => save(g.areaId, g.links.filter((_, j) => j !== i)) : undefined} />
          ))}
          {!g.links.length && <p className="text-xs text-slate-500">{g.areaId ? "No links for this area yet." : "None"}</p>}
          {editing && <AddLink bashId={bashId} onPick={(l) => !g.links.some((x) => x.kind === l.kind && x.key === l.key) && save(g.areaId, [...g.links, l])} />}
        </div>
      ))}
      {editing && <p className="text-[11px] text-slate-500">{pending ? "Saving…" : "You started this bash, so you can change links. Everyone sees the change right away."}</p>}
    </div>
  );
}
