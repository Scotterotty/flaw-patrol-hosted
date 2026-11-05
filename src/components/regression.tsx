"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setRegressionOff } from "@/server/regression";
import { InfoTip } from "./ui";

/** "Compared with Web RC 21 ▾" above a run's cases: what the Regression flag measures against. */
export function CompareWith({ label, only, choices, count, path }: { label: string; only: string | null; choices: string[]; count: number; path: string }) {
  const router = useRouter();
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="font-bold text-pink-600">!</span>
        {count ? `${count} ${count === 1 ? "regression" : "regressions"}` : "No regressions"} compared with
      </span>
      {choices.length > 1 ? (
        <select
          aria-label="Compare with"
          data-howto="run-compare"
          className="h-7 rounded-md border border-slate-300 bg-surface px-1.5 text-xs"
          value={only ?? ""}
          onChange={(e) => router.push(e.target.value ? `${path}?compare=${encodeURIComponent(e.target.value)}` : path)}
        >
          <option value="">{only ? "The usual earlier release" : label}</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <span className="font-medium text-slate-800">{label}</span>
      )}
      <InfoTip text="A case gets the Regression mark when it passed the last time it ran in an earlier release on this platform, and fails now. Flaky cases and cases that never passed don't get it. Pick another release if the last one was a partial run." />
    </div>
  );
}

/**
 * Under a failed step in the runner: this step passed in the earlier release, so it looks new.
 * Report a bug and See what it looked like are handed in; Turn the flag off saves at once and can be undone.
 */
export function RegressionNote({
  projectId,
  entryId,
  label,
  when,
  off,
  onReport,
  onShow,
}: {
  projectId: string;
  entryId: string;
  label: string;
  when: string;
  off: boolean;
  onReport?: () => void;
  onShow?: () => void;
}) {
  const router = useRouter();
  const [isOff, setOff] = useState(off);
  const [pending, start] = useTransition();
  const toggle = (v: boolean) =>
    start(async () => {
      setOff(v);
      const r = await setRegressionOff(projectId, entryId, v);
      if (!r.ok) setOff(!v);
      router.refresh();
    });
  if (isOff)
    return (
      <p className="mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200 ring-inset">
        The Regression flag is off for this case in this run.{" "}
        <button type="button" disabled={pending} className="font-medium text-accent-700 hover:underline" onClick={() => toggle(false)}>
          Turn it back on
        </button>
      </p>
    );
  return (
    <div role="note" className="mt-1.5 rounded-md bg-pink-50 px-2.5 py-2 text-xs text-pink-900 ring-1 ring-pink-200 ring-inset">
      <p>
        <span aria-hidden className="mr-1 font-bold">!</span>
        This step passed in {label} ({when}). So this looks new, and is worth a bug.
      </p>
      <p className="mt-1.5 flex flex-wrap gap-3">
        {onReport && (
          <button type="button" className="font-medium text-pink-800 hover:underline" onClick={onReport}>
            Report a bug
          </button>
        )}
        {onShow && (
          <button type="button" className="font-medium text-pink-800 hover:underline" onClick={onShow}>
            See what {label} looked like
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          className="font-medium text-pink-800 hover:underline"
          title="For when the flag is wrong, for example the case was rewritten. Anyone can do this, and you can turn it back on."
          onClick={() => toggle(true)}
        >
          Turn the flag off
        </button>
      </p>
    </div>
  );
}
