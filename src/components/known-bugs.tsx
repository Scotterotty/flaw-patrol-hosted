"use client";

import { useState } from "react";
import type { KnownBug } from "@/lib/known-bugs";
import { Button, cx } from "./ui";

// Known bugs: bugs found on this case in earlier runs, above the steps, with
// Still happens and Didn't happen. Both undo with one click until the case is saved.

export type KnownCheck = "still" | "gone";

const ago = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d < 1 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

export function KnownStatus({ bug }: { bug: Pick<KnownBug, "state" | "status"> }) {
  return (
    <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", bug.state === "open" ? "bg-red-50 text-red-800" : bug.state === "fixed" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500")}>
      {bug.state === "fixed" ? `${bug.status} · check it` : bug.status}
    </span>
  );
}

/** The amber box above the steps. */
export function KnownBugsBox({
  bugs,
  checks,
  onCheck,
  disabled,
  steps,
}: {
  bugs: KnownBug[];
  checks: Record<string, KnownCheck | undefined>;
  onCheck: (bug: KnownBug, outcome: KnownCheck | null) => void;
  disabled: boolean;
  steps: { number: string }[];
}) {
  const [open, setOpen] = useState(true);
  if (!bugs.length) return null;
  const live = bugs.filter((b) => b.state !== "expected");
  return (
    <section className="mb-4 rounded-lg border border-amber-300 bg-amber-50" data-testid="known-bugs" data-howto="runner-known-bugs" aria-label="Known bugs">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>🐞</span>
        <span className="flex-1">
          <span className="block text-sm font-semibold text-amber-950">
            {bugs.length} known {bugs.length === 1 ? "bug" : "bugs"} on this case
          </span>
          <span className="block text-xs text-amber-900">Found in earlier runs. Status from Jira{live.length ? ". Check each one as you go." : "."}</span>
        </span>
        <span aria-hidden className="text-amber-800">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-amber-200 border-t border-amber-200">
          {bugs.map((b) => {
            const c = checks[b.id];
            return (
              <li key={b.id} className={cx("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm", b.state === "expected" && "opacity-60")}>
                <span className="min-w-0 flex-1 basis-64">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {b.url ? (
                      <a href={b.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold text-accent-700 hover:underline">
                        {b.key}
                      </a>
                    ) : (
                      <span className="font-mono text-xs font-semibold">{b.key}</span>
                    )}
                    <span className="text-slate-900">{b.title}</span>
                    <KnownStatus bug={b} />
                  </span>
                  <span className="block text-xs text-slate-600">
                    Found {b.found.step ? `at step ${b.found.step} ` : ""}in R{b.found.run} by {b.found.by}, {ago(b.found.at)}
                    {b.stepIndex !== null && steps[b.stepIndex] && b.found.step !== steps[b.stepIndex].number && ` · now step ${steps[b.stepIndex].number}`}
                  </span>
                </span>
                {b.state === "expected" ? (
                  <span className="text-xs text-slate-500">Expected, no check needed</span>
                ) : c ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span className={cx("rounded-full px-2 py-0.5 font-semibold", c === "still" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800")}>{c === "still" ? "✓ Still happens" : "✓ Didn't happen"}</span>
                    {!disabled && (
                      <button type="button" className="text-accent-700 hover:underline" onClick={() => onCheck(b, null)}>
                        Undo
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="flex gap-1.5">
                    <Button size="sm" disabled={disabled} onClick={() => onCheck(b, "still")} data-howto="known-still" title="Marks its step Failed, links this bug and adds a line to the comment">
                      Still happens
                    </Button>
                    <Button size="sm" disabled={disabled} onClick={() => onCheck(b, "gone")} data-howto="known-gone" title="Records that this run didn't see it. Jira isn't changed.">
                      Didn&apos;t happen
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** "Known bug KEY" on the step it was found at. */
export function KnownStepTag({ bug }: { bug: KnownBug }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold", bug.state === "expected" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-900")} title={`${bug.title} · ${bug.status}`}>
      Known bug {bug.key}
      {bug.state === "fixed" && " · fixed?"}
    </span>
  );
}
