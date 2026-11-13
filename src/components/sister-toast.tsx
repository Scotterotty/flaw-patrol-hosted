"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { filledLine } from "@/lib/sisters";
import type { FillSummary } from "@/lib/sisters-server";
import { undoSisterFill } from "@/server/sisters";

// Sister cases: after a dry run save, a green line says which RC cases filled in, with Undo.
// It lives in the root layout, so it stays while the runner moves on to the next case.

const EVENT = "fp-sisters";

/** Show what a dry run save filled in on the RC runs. */
export function showSisterFill(s: FillSummary | undefined) {
  if (s && (s.items.length || s.disagree)) window.dispatchEvent(new CustomEvent(EVENT, { detail: s }));
}

export function SisterToaster() {
  const router = useRouter();
  const [shown, setShown] = useState<FillSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      setShown((e as CustomEvent<FillSummary>).detail);
      setNote(null);
      clearTimeout(timer);
      // Long enough to read it and press Undo; it stays while the pointer or focus is on it.
      timer = setTimeout(() => setShown((s) => (document.querySelector("[data-sister-toast]:hover, [data-sister-toast]:focus-within") ? s : null)), 15000);
    };
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener(EVENT, on);
      clearTimeout(timer);
    };
  }, []);
  if (!shown && !note) return null;
  const undo = () =>
    start(async () => {
      if (!shown?.at) return;
      const r = await undoSisterFill(shown.at, shown.items.map((i) => i.entryId));
      setShown(null);
      setNote(r.ok ? "Undone. The RC steps are back to no result." : r.error);
      setTimeout(() => setNote(null), 6000);
      router.refresh();
    });
  return (
    <div role="status" aria-live="polite" data-sister-toast className="fp-right fixed right-4 bottom-16 left-4 z-50 flex justify-end md:bottom-4 md:left-auto">
      {shown ? (
        <div className="flex w-full max-w-md flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-emerald-600 bg-emerald-50 px-3.5 py-2.5 text-sm text-slate-900 shadow-lg" data-testid="sister-toast">
          <span aria-hidden className="pt-0.5 text-emerald-700">
            ✓
          </span>
          <span className="min-w-0 flex-1">
            {shown.items.length > 0 && (
              <>
                <strong className="font-semibold">Also filled in the RC:</strong> {filledLine(shown.items.map((i) => ({ title: i.title, where: i.where })))}.
              </>
            )}
            {shown.disagree > 0 && (
              <span className="block text-xs text-amber-800">
                {shown.disagree === 1 ? "1 RC step already had a different result. It wasn't changed." : `${shown.disagree} RC steps already had a different result. They weren't changed.`}
              </span>
            )}
          </span>
          <span className="flex gap-2">
            {shown.at && (
              <button type="button" onClick={undo} disabled={pending} className="min-h-9 rounded-md border border-slate-300 bg-surface px-3 font-medium text-slate-800 hover:bg-slate-50">
                {pending ? "Undoing…" : "Undo"}
              </button>
            )}
            <button type="button" onClick={() => setShown(null)} aria-label="Close" className="min-h-9 px-1.5 text-slate-600 hover:text-slate-900">
              ✕
            </button>
          </span>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm text-slate-50 shadow-lg">{note}</div>
      )}
    </div>
  );
}
