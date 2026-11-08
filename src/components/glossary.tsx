"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { findTerm, lookupText, matcherFor, splitTerms, type GlossaryLite, type TextPart } from "@/lib/glossary";
import { addGlossaryTerm, askGlossaryTerm, glossaryForPage, glossaryLookedUp, setGlossaryUnderline } from "@/server/glossary";
import { Modal } from "./modal";
import { Button, cx, Field, Input, Select, Textarea } from "./ui";

// Glossary: the team's words, explained once and found everywhere. This file holds
// what every page shares: the dotted underlines, the meaning card, Look it up on selected text
// and the Add to Glossary box. The Glossary page itself is glossary-page.tsx.

type Group = { id: string; name: string };
type Found = { label: string; url: string };
type Ctx = {
  terms: GlossaryLite[];
  matcher: ReturnType<typeof matcherFor>;
  canEdit: boolean;
  groups: Group[];
  underline: boolean;
  setUnderline: (on: boolean) => void;
  refresh: () => void;
  /** Open the meaning of a term (or the Add box when nobody has added it yet). */
  lookUp: (text: string, found?: Found) => void;
  /** Open the Add box: "add" with a meaning, or "ask" the team. */
  openAdd: (mode: "add" | "ask", term?: string, found?: Found) => void;
};

const GlossaryCtx = createContext<Ctx | null>(null);
export const useGlossary = () => useContext(GlossaryCtx);

/** Where the Glossary page is from here: this project's, or the shared /glossary link. */
export function glossaryHref(path: string | null, slug?: string, extra = "term") {
  const m = path?.match(/^\/p\/([^/]+)/);
  const base = m ? `/p/${m[1]}/glossary` : "/glossary";
  if (!slug) return base;
  return m ? `${base}?${extra}=${encodeURIComponent(slug)}` : extra === "term" ? `/glossary/${encodeURIComponent(slug)}` : `${base}?${extra}=${encodeURIComponent(slug)}`;
}

/** Opening a meaning counts once per person and term, for Terms that helped. */
const counted = new Set<string>();
function countLookup(id: string) {
  if (counted.has(id)) return;
  counted.add(id);
  void glossaryLookedUp(id);
}

/** Where the selected words were found: the nearest [data-glossary-source] or the page's title. */
function foundAt(node: Node | null): Found {
  const el = node instanceof Element ? node : node?.parentElement;
  const src = (el?.closest<HTMLElement>("[data-glossary-source]") ?? el?.closest("dialog")?.querySelector<HTMLElement>("[data-glossary-source]"))?.dataset.glossarySource;
  const title = document.title.replace(/\s*·\s*Flaw Patrol$/, "");
  return { label: (src || title || "Flaw Patrol").slice(0, 200), url: `${location.pathname}${location.search}`.slice(0, 500) };
}

export function GlossaryProvider({ underline: initialUnderline, children }: { underline: boolean; children: ReactNode }) {
  const [data, setData] = useState<{ terms: GlossaryLite[]; canEdit: boolean; groups: Group[] }>({ terms: [], canEdit: false, groups: [] });
  const [underline, setUnderlineState] = useState(initialUnderline);
  const [open, setOpen] = useState<{ term: GlossaryLite } | null>(null);
  const [adding, setAdding] = useState<{ mode: "add" | "ask"; term: string; found?: Found } | null>(null);
  const path = usePathname();
  const refresh = useCallback(() => {
    glossaryForPage()
      .then(setData)
      .catch(() => {});
  }, []);
  // Load once, and again when the page changes so a term someone just added shows up.
  useEffect(refresh, [refresh, path]);
  useEffect(() => setUnderlineState(initialUnderline), [initialUnderline]);
  const matcher = useMemo(() => matcherFor(data.terms), [data.terms]);
  const setUnderline = useCallback((on: boolean) => {
    setUnderlineState(on);
    void setGlossaryUnderline(on);
  }, []);
  const openAdd = useCallback((mode: "add" | "ask", term = "", found?: Found) => setAdding({ mode, term, found }), []);
  const lookUp = useCallback(
    (text: string, found?: Found) => {
      const hit = findTerm(data.terms, text);
      if (hit) {
        if (hit.meaning) countLookup(hit.id);
        setOpen({ term: hit });
      } else setAdding({ mode: data.canEdit ? "add" : "ask", term: text, found });
    },
    [data.terms, data.canEdit],
  );
  const ctx: Ctx = { ...data, matcher, underline, setUnderline, refresh, lookUp, openAdd };
  return (
    <GlossaryCtx.Provider value={ctx}>
      {children}
      <LookItUp />
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? open.term.term : ""}>
        {open && <TermCard term={open.term} onDone={() => setOpen(null)} />}
      </Modal>
      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding?.mode === "ask" ? `Ask the team${adding.term ? ` about "${adding.term}"` : ""}` : adding?.term ? `Add "${adding.term}" to the Glossary` : "Add a term"}>
        {adding && (
          <AddTermForm
            key={`${adding.mode}:${adding.term}`}
            initial={adding}
            onSwitch={(mode) => setAdding({ ...adding, mode })}
            onDone={() => {
              setAdding(null);
              refresh();
            }}
          />
        )}
      </Modal>
    </GlossaryCtx.Provider>
  );
}

/** A term's meaning with its links: Open in Glossary, Edit, Answer it. */
function TermCard({ term, onDone }: { term: GlossaryLite; onDone?: () => void }) {
  const g = useGlossary();
  const path = usePathname();
  return (
    <div className="space-y-3 text-sm" data-testid="glossary-card">
      {term.aliases.length > 0 && <p className="text-xs text-slate-500">Also called: {term.aliases.join(", ")}</p>}
      {term.meaning ? (
        <p className="whitespace-pre-line text-slate-800">{term.meaning}</p>
      ) : (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">Nobody has answered this one yet. It&apos;s waiting under Needs an answer.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={glossaryHref(path, term.slug)} onClick={onDone} className="font-medium text-accent-700 hover:underline">
          Open in Glossary
        </Link>
        {g?.canEdit && (
          <Link href={glossaryHref(path, term.slug, "edit")} onClick={onDone} className="font-medium text-accent-700 hover:underline">
            {term.meaning ? "Edit" : "Answer it"}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Text with the Glossary's terms underlined, each only the first time it shows up. Plain
 * text when underlines are off. For several texts that make one card, see useTermParts.
 */
export function GlossaryText({ text }: { text: string }) {
  const parts = useTermParts([text]);
  return parts ? <TermParts parts={parts[0]} /> : <>{text}</>;
}

/**
 * Split several texts of one card (a step's action and links, say) in one go, so a term is
 * underlined once across all of them. Null when underlines are off or nothing is known.
 * Worked out fresh on each render, never by changing a shared set while rendering.
 */
export function useTermParts(texts: string[]): TextPart[][] | null {
  const g = useGlossary();
  if (!g || !g.underline || !g.matcher) return null;
  const seen = new Set<string>();
  return texts.map((t) => splitTerms(t, g.matcher, seen));
}

export function TermParts({ parts }: { parts: TextPart[] }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <TermMark key={i} term={p.term} text={p.text} />))}
    </>
  );
}

/** One underlined term: point at it, tap it or Tab to it for its meaning. */
function TermMark({ term, text }: { term: GlossaryLite; text: string }) {
  const g = useGlossary();
  const path = usePathname();
  const ref = useRef<HTMLSpanElement>(null);
  // Fixed to the screen (and inside an open popup box, if the word is in one) so a table or
  // card that clips its overflow can't cut the meaning off.
  const [at, setAt] = useState<{ top: number; left: number; up: boolean; host: Element } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = () => {
    if (timer.current) clearTimeout(timer.current);
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const up = r.bottom + 200 > window.innerHeight && r.top > 220;
    setAt({ top: up ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), up, host: el.closest("dialog[open]") ?? document.body });
    countLookup(term.id);
  };
  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAt(null), 150);
  };
  useEffect(() => {
    if (!at) return;
    const hide = () => setAt(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [at]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      aria-expanded={!!at}
      aria-label={`${text}: Glossary term`}
      data-testid="glossary-term"
      className="cursor-help underline decoration-accent-500 decoration-dotted decoration-2 underline-offset-[3px]"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onClick={(e) => {
        // A click focuses it first, which already opened the meaning; keep it open.
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setAt(null);
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (at) setAt(null);
          else open();
        }
      }}
    >
      {text}
      {at &&
        createPortal(
          <span
            role="tooltip"
            data-testid="glossary-hover"
            data-glossary-ignore
            onMouseEnter={open}
            onMouseLeave={close}
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", top: at.top, left: at.left, transform: at.up ? "translateY(-100%)" : undefined, zIndex: 60 }}
            className="block w-72 max-w-[calc(100vw-16px)] cursor-auto rounded-lg border border-slate-200 bg-surface p-3 text-left text-sm font-normal whitespace-normal text-slate-800 normal-case no-underline shadow-lg"
          >
            <span className="block font-semibold text-slate-900">{term.term}</span>
            <span className="mt-1 block whitespace-pre-line">{term.meaning}</span>
            <span className="mt-2 flex items-center gap-3 text-xs font-medium">
              <Link href={glossaryHref(path, term.slug)} className="text-accent-700 hover:underline">
                Open in Glossary
              </Link>
              {g?.canEdit && (
                <Link href={glossaryHref(path, term.slug, "edit")} className="text-accent-700 hover:underline">
                  Edit
                </Link>
              )}
            </span>
            <span className="mt-2 block border-t border-slate-200 pt-2 text-xs">
              <button type="button" className="text-slate-500 hover:text-slate-800 hover:underline" onClick={() => g?.setUnderline(false)}>
                Hide underlines
              </button>
            </span>
          </span>,
          at.host,
        )}
    </span>
  );
}

/**
 * Select a word or short phrase anywhere (not in a box you type in) and a small "Look it up"
 * button appears above it. Click it or press G: the meaning if it's in the Glossary, else the
 * Add box with the word filled in and where you found it.
 */
function LookItUp() {
  const g = useGlossary();
  const [sel, setSel] = useState<{ text: string; x: number; y: number; host: Element; found: Found } | null>(null);
  const known = sel && g ? findTerm(g.terms, sel.text) : undefined;

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      const s = document.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return setSel(null);
      const node = s.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      // Not while typing, and not inside the Glossary's own boxes.
      if (!el || el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-glossary-ignore]")) return setSel(null);
      const text = lookupText(s.toString());
      if (!text) return setSel(null);
      const r = s.getRangeAt(0).getBoundingClientRect();
      if (!r.width && !r.height) return setSel(null);
      setSel({ text, x: r.left + r.width / 2, y: r.top, host: el.closest("dialog[open]") ?? document.body, found: foundAt(node) });
    };
    const later = () => {
      if (t) clearTimeout(t);
      t = setTimeout(read, 180);
    };
    document.addEventListener("selectionchange", later);
    window.addEventListener("scroll", later, true);
    return () => {
      document.removeEventListener("selectionchange", later);
      window.removeEventListener("scroll", later, true);
      if (t) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!sel || !g) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "g" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      e.stopPropagation();
      g.lookUp(sel.text, sel.found);
      setSel(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sel, g]);

  if (!sel || !g) return null;
  const top = Math.max(8, sel.y - 40);
  const left = Math.min(Math.max(8, sel.x), window.innerWidth - 8);
  return createPortal(
    <button
      type="button"
      data-testid="glossary-lookup"
      data-howto="glossary-lookup"
      data-glossary-ignore
      // Keep the selection: a mousedown here would otherwise clear it before the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        g.lookUp(sel.text, sel.found);
        setSel(null);
      }}
      style={{ position: "fixed", top, left, transform: "translateX(-50%)", zIndex: 60 }}
      className="flex items-center gap-2 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow-lg after:absolute after:top-full after:left-1/2 after:-ml-1 after:border-4 after:border-transparent after:border-t-slate-900 dark:bg-slate-100 dark:text-slate-900"
    >
      {known ? "Look it up" : g.canEdit ? "Look it up / Add to Glossary" : "Look it up / Ask the team"}
      <kbd className="rounded border border-white/30 px-1 font-mono text-[11px] font-normal opacity-80">G</kbd>
    </button>,
    sel.host,
  );
}

/**
 * Add a term (with its meaning) or ask the team (just the word and your question). Viewers
 * only get the ask form. Used from Look it up and from the Glossary page.
 */
export function AddTermForm({
  initial,
  onSwitch,
  onDone,
}: {
  initial: { mode: "add" | "ask"; term: string; found?: Found };
  onSwitch: (mode: "add" | "ask") => void;
  onDone: (slug: string) => void;
}) {
  const g = useGlossary();
  const router = useRouter();
  const [term, setTerm] = useState(initial.term);
  const [aliases, setAliases] = useState("");
  const [meaning, setMeaning] = useState("");
  const [question, setQuestion] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = initial.mode === "ask" || !g?.canEdit;
  const found = initial.found;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = ask
      ? await askGlossaryTerm({ term, question, foundLabel: found?.label ?? "", foundUrl: found?.url ?? "" })
      : await addGlossaryTerm({ term, aliases, meaning, groupId: groupId || null, foundLabel: found?.label ?? "", foundUrl: found?.url ?? "" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
    onDone(res.slug);
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-glossary-ignore>
      <Field label="Term" htmlFor="gl-term">
        <Input id="gl-term" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={80} required autoFocus={!initial.term} />
      </Field>
      {ask ? (
        <Field label="Your question" htmlFor="gl-question" hint="Optional. What would you like to know? Someone on the team will answer.">
          <Textarea id="gl-question" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What does it stand for, and where do I find it?" autoFocus={!!initial.term} />
        </Field>
      ) : (
        <>
          <Field label="Other names" htmlFor="gl-aliases" hint="Optional. Abbreviations or other spellings, separated by commas, so they're found and underlined too.">
            <Input id="gl-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="e.g. org, workspace" />
          </Field>
          <Field label="What it means" htmlFor="gl-meaning" hint="Plain words, the way you'd explain it to someone on their first day.">
            <Textarea id="gl-meaning" rows={4} value={meaning} onChange={(e) => setMeaning(e.target.value)} required autoFocus={!!initial.term} />
          </Field>
          {(g?.groups.length ?? 0) > 0 && (
            <Field label="Who it's for" htmlFor="gl-group">
              <Select id="gl-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className="h-9">
                <option value="">Everyone</option>
                {g!.groups.map((x) => (
                  <option key={x.id} value={x.id}>
                    Only {x.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </>
      )}
      {found?.label && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Found on <span className="font-semibold text-slate-800">{found.label}</span>. Saved with the term so others can see where it came up.
        </p>
      )}
      {!g?.canEdit && <p className="text-xs text-slate-500">Viewers can ask the team. Anyone who can edit will see your question under Needs an answer.</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {ask ? "Ask the team" : "Add term"}
        </Button>
        {g?.canEdit && (
          <button type="button" className={cx("text-sm font-medium text-accent-700 hover:underline")} onClick={() => onSwitch(ask ? "add" : "ask")}>
            {ask ? "I know what it means" : "Don't know what it means? Ask the team instead"}
          </button>
        )}
      </div>
    </form>
  );
}
