"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cleanSpinners, SPINNER_FOLD, SPINNERS, spinnerLine, type SpinnerId } from "@/lib/spinners";
import { updateMySpinners } from "@/server/account";
import { FoldHeader } from "./fold-card";
import { SpinnerArt } from "./loading-spinner";
import { useOpenCard } from "./open-cards";
import { cx, ErrorText } from "./ui";

/**
 * Account → Appearance → Loading spinners: tick the ones you like. Long waits play
 * one of them at random; with none ticked you get the plain ring. Open to everyone.
 * Folds to one line: what you ticked, small still pictures of up to 4, and "N of 13".
 * Starts closed; open or closed is saved on your account like the other folding cards.
 */
export function SpinnerPicker({ initial, pawn }: { initial: SpinnerId[]; pawn: string }) {
  const router = useRouter();
  const [mine, setMine] = useState<SpinnerId[]>(cleanSpinners(initial));
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const save = (next: SpinnerId[]) => {
    const clean = cleanSpinners(next);
    setMine(clean);
    // Applies at once; the next wait picks from these.
    document.documentElement.dataset.spinners = clean.join(" ");
    start(async () => {
      const res = await updateMySpinners(clean);
      setError(res.ok ? null : res.error);
      if (res.ok) router.refresh();
    });
  };
  const all = mine.length === SPINNERS.length;
  const { open, toggle } = useOpenCard(SPINNER_FOLD);
  const picked = SPINNERS.filter((s) => mine.includes(s.id));
  return (
    <section className="border-t border-slate-200 pt-1.5" data-testid="spinner-picker">
      <FoldHeader
        title="Loading spinners"
        summary={<span data-testid="spinner-summary">{spinnerLine(mine)}</span>}
        open={open}
        onToggle={toggle}
        pill={
          <span className="flex flex-none items-center gap-2">
            <span aria-hidden className="fp-still hidden items-center gap-1 sm:flex">
              {picked.slice(0, 4).map((s) => (
                <SpinnerArt key={s.id} id={s.id} size={20} pawn={pawn} />
              ))}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">
              {mine.length} of {SPINNERS.length}
            </span>
          </span>
        }
      />
      {open && (
        <div className="pt-1 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="min-w-0 flex-1 text-xs text-slate-500">
              Shown while Flaw Patrol is busy, like when a run starts or opens. Tick one to always see it, or several to mix them up. Point at one to see it move.
            </p>
            <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onClick={() => save(all ? ["ring"] : SPINNERS.map((s) => s.id))}>
              {all ? "Back to the plain ring" : "Tick all"}
            </button>
          </div>
          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
            {SPINNERS.map((s) => {
              const on = mine.includes(s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    title={s.help}
                    onClick={() => save(on ? mine.filter((x) => x !== s.id) : [...mine, s.id])}
                    className={cx(
                      "fp-still flex h-full w-full flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-center",
                      on ? "border-accent-600 bg-accent-50 ring-2 ring-accent-500/30" : "border-slate-200 hover:border-slate-300",
                    )}
                  >
                    <SpinnerArt id={s.id} size={40} pawn={pawn} />
                    <span className="text-xs font-medium text-slate-800">{s.label}</span>
                    <span className={cx("text-[11px]", on ? "font-semibold text-accent-700" : "text-slate-500")}>{on ? "✓ Ticked" : "Tick to use"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </section>
  );
}
