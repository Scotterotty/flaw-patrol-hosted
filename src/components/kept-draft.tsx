"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { dropKept, keptKey, readKept, sweepKept, writeKept } from "@/lib/kept-draft";
import { useZone } from "./spelling";

// Keep what you're typing (src/lib/kept-draft.ts): one hook every writing form uses, so they all
// behave the same way: the green "We kept what you were writing" note with Start fresh, and a
// quiet "✓ Saved on this computer" line beside the form's buttons.

const Owner = createContext("");

/** Set once in the root layout: whose drafts these are, so people sharing a computer never see each other's. */
export function KeptOwnerProvider({ owner, children }: { owner: string; children: ReactNode }) {
  return <Owner.Provider value={owner}>{children}</Owner.Provider>;
}

export type KeptDraft = {
  /** When the draft that was brought back was last saved; null when the form started empty. */
  restoredAt: number | null;
  /** When what's on screen was last kept; null when nothing is kept. */
  savedAt: number | null;
  /** The form was saved or sent: forget the draft. */
  clear: () => void;
  /** Throw the draft away and empty the form. */
  startFresh: () => void;
};

const store = () => (typeof window === "undefined" ? null : window.localStorage);
let swept = false;
const SAVE_AFTER_MS = 400;

/**
 * Keeps `value` in this browser while you type, under `place` (null while the form isn't open),
 * and hands a kept draft to `restore` when the form opens again (return false to leave it be). `ready` waits for a form that
 * fills itself in (a template loading) before comparing, and `reset` empties the form for Start fresh.
 * Only what you change is kept: a form you open and leave untouched keeps nothing.
 */
export function useKeptDraft<T>(place: string | null, value: T, restore: (v: T) => void | false, opts: { ready?: boolean; reset?: () => void } = {}): KeptDraft {
  const owner = useContext(Owner);
  const ready = opts.ready ?? true;
  const key = owner && place ? keptKey(owner, place) : null;
  const json = JSON.stringify(value);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const loaded = useRef<string | null>(null); // the place a draft was looked for
  const base = useRef<string | null>(null); // the form as it opened
  const written = useRef<string | null>(null); // what's in storage now
  const latest = useRef<{ k: string; j: string } | null>(null); // waiting to be kept
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const fns = useRef({ restore, reset: opts.reset });
  fns.current = { restore, reset: opts.reset };

  // Look for a kept draft once the form is open and filled in.
  useEffect(() => {
    if (!key || !ready || loaded.current === key) return;
    const s = store();
    if (!s) return;
    if (!swept) {
      swept = true;
      sweepKept(s, Date.now());
    }
    loaded.current = key;
    base.current = json;
    written.current = null;
    touched.current = false;
    setRestoredAt(null);
    setSavedAt(null);
    const got = readKept<T>(s, key, Date.now());
    if (got && JSON.stringify(got.data) !== json) {
      // The form may decline a draft it can't show here (its test cycle isn't on this page).
      if (fns.current.restore(got.data) === false) return;
      written.current = JSON.stringify(got.data);
      touched.current = true;
      setRestoredAt(got.at);
      setSavedAt(got.at);
    }
    // json is read as the form opened, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  // Anything you type, pick or click from here on counts as a change worth keeping.
  useEffect(() => {
    if (!key) return;
    const on = () => (touched.current = true);
    const kinds = ["input", "change", "click"] as const;
    kinds.forEach((k) => document.addEventListener(k, on, true));
    return () => kinds.forEach((k) => document.removeEventListener(k, on, true));
  }, [key]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const w = latest.current;
    const s = store();
    latest.current = null;
    if (!w || !s) return;
    const { k, j } = w;
    if (j === base.current) {
      // Back to how it opened (everything erased): nothing to keep.
      if (written.current !== null) dropKept(s, k);
      written.current = null;
      setSavedAt(null);
      return;
    }
    if (j === written.current) return;
    const now = Date.now();
    if (writeKept(s, k, JSON.parse(j), now)) {
      written.current = j;
      setSavedAt(now);
    }
  }, []);

  useEffect(() => {
    if (!key || loaded.current !== key || !touched.current) return;
    latest.current = { k: key, j: json };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER_MS);
  }, [json, key, flush]);

  // A refresh, closed tab or switched app keeps the last keystrokes too; so does closing the box.
  useEffect(() => {
    const hide = () => flush();
    const vis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", hide);
    window.addEventListener("beforeunload", hide);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("beforeunload", hide);
      document.removeEventListener("visibilitychange", vis);
      flush();
    };
  }, [flush]);
  // The form closed (place went to null) while something waited to be kept.
  useEffect(() => {
    if (!key) {
      flush();
      loaded.current = null;
      setRestoredAt(null);
    }
  }, [key, flush]);

  const forget = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current = null;
    touched.current = false;
    const s = store();
    if (keyRef.current && s) dropKept(s, keyRef.current);
    written.current = null;
    setSavedAt(null);
    setRestoredAt(null);
  }, []);

  const startFresh = useCallback(() => {
    forget();
    fns.current.reset?.();
  }, [forget]);

  return { restoredAt, savedAt, clear: forget, startFresh };
}

function useClock() {
  const zone = useZone();
  return (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
}

/** "We kept what you were writing (3:42 PM). Start fresh": shown when a draft came back. */
export function KeptNote({ kept, what = "what you were writing", className = "" }: { kept: KeptDraft; what?: string; className?: string }) {
  const clock = useClock();
  if (kept.restoredAt === null) return null;
  return (
    <div role="status" data-testid="kept-note" className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ${className}`}>
      <span>
        We kept {what} ({clock(kept.restoredAt)}).
      </span>
      <button type="button" onClick={kept.startFresh} data-howto="kept-fresh" className="ml-auto font-semibold text-emerald-900 underline underline-offset-2 hover:no-underline">
        Start fresh
      </button>
    </div>
  );
}

/** "✓ Saved on this computer · 3:44 PM": beside the form's buttons while a draft is kept. */
export function KeptSaved({ kept, className = "" }: { kept: KeptDraft; className?: string }) {
  const clock = useClock();
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(window.matchMedia("(pointer: coarse) and (max-width: 640px)").matches), []);
  if (kept.savedAt === null) return null;
  return (
    <span data-testid="kept-saved" className={`text-xs font-medium text-emerald-700 ${className}`} title="Kept in this browser until you save it, click Start fresh, or 7 days pass.">
      ✓ Saved on this {phone ? "phone" : "computer"} · {clock(kept.savedAt)}
    </span>
  );
}
