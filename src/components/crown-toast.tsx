"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ackCrowns, wearCrown } from "@/server/account";

export type CrownChange = {
  id: string;
  kind: "took" | "lost";
  label: string;
  groupId: string;
  umbrella: string;
  /** The pages of its umbrella; null for the team's Keeper of Words (any umbrella). */
  paths: string[] | null;
  titleId?: string;
  line: string;
  sub: string;
};

/** How long a crown note stays (ver_140), unless you point at it or tab into it. */
export const CROWN_NOTE_MS = 10_000;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
/** Inside an umbrella: its overview and settings, or any of its projects' pages. The Glossary counts too. */
const inAnyUmbrella = (path: string) => under(path, "/g") || under(path, "/p") || under(path, "/glossary");
const showsHere = (c: CrownChange, path: string) => (c.paths ? c.paths.some((p) => under(path, p)) : inAnyUmbrella(path));

type Note = { key: string; changes: CrownChange[] };

/**
 * Mini game crowns (ver_96): a one-time note when you take a crown or someone takes yours.
 * ver_140: a note only shows inside its own umbrella (Keeper of Words, the team's, shows in
 * any), crowns taken in the same umbrella at once share one note, and notes close after 10
 * seconds. Notes that haven't shown yet wait for their umbrella; no email or Slack.
 */
export function CrownToaster({ changes }: { changes: CrownChange[] }) {
  const path = usePathname() ?? "/";
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const acked = useRef(new Set<string>());

  const here = useMemo(() => changes.filter((c) => !gone.has(c.id) && showsHere(c, path)), [changes, gone, path]);

  // Mark them seen as soon as they show, so they don't come back on the next page.
  useEffect(() => {
    const fresh = here.filter((c) => !acked.current.has(c.id));
    if (!fresh.length) return;
    for (const c of fresh) acked.current.add(c.id);
    void ackCrowns({ took: fresh.filter((c) => c.kind === "took").map((c) => c.id), lost: fresh.filter((c) => c.kind === "lost").map((c) => c.id) });
  }, [here]);

  // Crowns taken in the same umbrella share a note; each lost crown has its own.
  const notes: Note[] = [];
  for (const c of here) {
    const together = c.kind === "took" ? notes.find((n) => n.changes[0].kind === "took" && n.changes[0].groupId === c.groupId) : null;
    if (together) together.changes.push(c);
    else notes.push({ key: c.id, changes: [c] });
  }
  if (!notes.length) return null;
  const close = (n: Note) => setGone((s) => new Set([...s, ...n.changes.map((c) => c.id)]));
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-16 z-50 flex flex-col items-end gap-2 md:bottom-4" data-testid="crown-toasts">
      {notes.map((n) => (
        <CrownNote key={n.key} changes={n.changes} onClose={() => close(n)} onWorn={(id) => setGone((s) => new Set([...s, id]))} />
      ))}
    </div>
  );
}

function CrownNote({ changes, onClose, onWorn }: { changes: CrownChange[]; onClose: () => void; onWorn: (id: string) => void }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [paused, setPaused] = useState(false);
  const hovered = useRef(false);
  const focused = useRef(false);
  const left = useRef(CROWN_NOTE_MS);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Count down only while nobody is pointing at or tabbed into the note.
  useEffect(() => {
    if (paused) return;
    const began = Date.now();
    const t = window.setTimeout(() => closeRef.current(), left.current);
    return () => {
      window.clearTimeout(t);
      left.current = Math.max(0, left.current - (Date.now() - began));
    };
  }, [paused]);
  const sync = () => setPaused(hovered.current || focused.current);

  const first = changes[0];
  const many = changes.length > 1;
  const line = many ? `You took ${changes.length} crowns in ${first.umbrella}: ${changes.map((c) => c.label).join(", ")}.` : first.line;
  const sub = many ? "Wear one next to your name, or pick later in Account." : first.sub;
  const wear = (c: CrownChange) =>
    start(async () => {
      await wearCrown(c.titleId!);
      if (many) onWorn(c.id);
      else onClose();
      router.refresh();
    });

  return (
    <div
      className="pointer-events-auto relative flex max-w-sm items-start gap-3 overflow-hidden rounded-lg bg-slate-900 px-3.5 py-2.5 text-slate-50 shadow-lg"
      data-testid="crown-note"
      onMouseEnter={() => {
        hovered.current = true;
        sync();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        sync();
      }}
      onFocus={() => {
        focused.current = true;
        sync();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focused.current = false;
        sync();
      }}
    >
      <span aria-hidden className="text-2xl leading-none">
        {first.kind === "took" ? "👑" : "🫥"}
      </span>
      <span className="min-w-0 text-sm">
        <strong className="block font-semibold">{line}</strong>
        <span className="block text-xs opacity-75">{sub}</span>
        {first.kind === "took" && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {changes
              .filter((c) => c.titleId)
              .map((c) => (
                <button key={c.id} type="button" className="rounded bg-amber-300 px-2 py-0.5 text-xs font-semibold text-slate-900 hover:bg-amber-200" onClick={() => wear(c)}>
                  {many ? `Wear ${c.label}` : "Wear it next to your name"}
                </button>
              ))}
          </span>
        )}
      </span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="ml-1 text-xs opacity-70 hover:opacity-100">
        ✕
      </button>
      {/* How long is left; it stops while the countdown is paused. */}
      <span
        aria-hidden
        className="crown-note-timer absolute bottom-0 left-0 h-[3px] w-full origin-left bg-amber-300"
        style={{ animationDuration: `${CROWN_NOTE_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
      />
    </div>
  );
}
