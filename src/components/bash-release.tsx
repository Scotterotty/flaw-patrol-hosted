"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setBashRelease } from "@/server/bashes";
import { buttonClass, cx } from "./ui";

/**
 * "Counts toward 2.4.0 · Change" on a bash's page and report (ver_152). Whoever started it,
 * or anyone who can start runs, can pick a release or keep it on its own.
 */
export function BashRelease({ bashId, release, releases, canChange }: { bashId: string; release: string; releases: string[]; canChange: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(release);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  // Nothing to say when there's no release to count toward and none is set.
  if (!release && !(canChange && releases.length)) return null;
  const choices = ["", ...releases.filter((r) => r !== release), ...(release ? [release] : [])];
  const save = () =>
    start(async () => {
      setError("");
      const res = await setBashRelease(bashId, pick);
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="bash-release-pill">
      <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", release ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600")}>
        {release ? `Counts toward ${release}` : "Not counted toward a release"}
      </span>
      {canChange && !open && (
        <button
          type="button"
          className="text-xs font-medium text-accent-700 hover:underline"
          onClick={() => {
            setPick(release);
            setOpen(true);
          }}
        >
          Change
        </button>
      )}
      {open && (
        <div className="flex w-full flex-wrap items-center gap-1.5">
          <div role="radiogroup" aria-label="Count it toward a release?" className="flex flex-wrap gap-1.5">
            {choices.map((r) => (
              <button
                key={r || "none"}
                type="button"
                role="radio"
                aria-checked={pick === r}
                onClick={() => setPick(r)}
                className={cx("rounded-full border px-3 py-1 text-[13px]", pick === r ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400")}
              >
                {r || "No, keep it on its own"}
              </button>
            ))}
          </div>
          <button type="button" className={buttonClass("primary", "sm")} disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
