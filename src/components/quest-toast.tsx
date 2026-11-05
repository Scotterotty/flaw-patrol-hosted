"use client";

import { useEffect, useState } from "react";

export type QuestMomentToast = { emoji: string; text: string; sub: string; href?: string; link?: string };

const EVENT = "fp-quest";

/** Show what a save did on the quest map. The toaster lives in the root layout, so it survives moving to the next case. */
export function showQuestMoments(list: QuestMomentToast[] | undefined) {
  if (list?.length) window.dispatchEvent(new CustomEvent(EVENT, { detail: list }));
}

/** Pop-ups for quest finds, encounters, trouble and rescues. */
export function QuestToaster() {
  const [shown, setShown] = useState<(QuestMomentToast & { id: number })[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const add = (e as CustomEvent<QuestMomentToast[]>).detail.map((m) => ({ ...m, id: ++n }));
      setShown((s) => [...s, ...add].slice(-3));
      for (const m of add) setTimeout(() => setShown((s) => s.filter((x) => x.id !== m.id)), 7000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div aria-live="polite" className="fp-right pointer-events-none fixed right-4 bottom-16 z-50 flex flex-col items-end gap-2 md:bottom-4">
      {shown.map((m) => (
        <div key={m.id} className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-lg bg-slate-900 px-3.5 py-2.5 text-slate-50 shadow-lg">
          <span aria-hidden className="text-2xl leading-none">
            {m.emoji}
          </span>
          <span className="min-w-0 text-sm">
            <strong className="block font-semibold">{m.text}</strong>
            <span className="block text-xs opacity-75">
              {m.sub}
              {m.href && (
                <>
                  {" "}
                  <a href={m.href} className="font-semibold underline">
                    {m.link}
                  </a>
                </>
              )}
            </span>
          </span>
          <button type="button" onClick={() => setShown((s) => s.filter((x) => x.id !== m.id))} aria-label="Dismiss" className="ml-1 self-start text-xs opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
