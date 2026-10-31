"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cleanSpinners, SPINNERS, type SpinnerId } from "@/lib/spinners";
import { updateMySpinners } from "@/server/account";
import { SpinnerArt } from "./loading-spinner";
import { cx, ErrorText } from "./ui";

/**
 * Account → Appearance → Loading spinners (ver_108): tick the ones you like. Long waits play
 * one of them at random; with none ticked you get the plain ring. Open to everyone.
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
  return (
    <div className="border-t border-slate-200 pt-4" data-testid="spinner-picker">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">
          Loading spinners{" "}
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">
            {mine.length === 1 ? SPINNERS.find((s) => s.id === mine[0])!.label : `${mine.length} ticked`}
          </span>
        </p>
        <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onClick={() => save(all ? ["ring"] : SPINNERS.map((s) => s.id))}>
          {all ? "Back to the plain ring" : "Tick all"}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        Shown while Flaw Patrol is busy, like when a run starts or opens. Tick one to always see it, or several to mix them up. Point at one to see it move.
      </p>
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
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}
