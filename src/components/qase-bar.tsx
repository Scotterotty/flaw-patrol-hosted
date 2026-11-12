"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { qaseRuns, setQaseRun, syncQaseNow } from "@/server/qase";
import { useSpelling } from "./spelling";
import { Button, cx, Select } from "./ui";

// A test cycle's Qase bar (ver_164): whether it's in sync, Sync now, and which Qase run it shares with.

export function QaseBar(props: {
  projectId: string;
  runTitle: string | null;
  runUrl: string;
  syncedAt: string | null;
  error: string;
  canSync: boolean;
  canChangeRun: boolean;
}) {
  const router = useRouter();
  const spelling = useSpelling();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<{ id: number; title: string }[] | null>(null);
  const [pending, start] = useTransition();
  const problem = error ?? props.error;

  const sync = () =>
    start(async () => {
      setError(null);
      setNote(null);
      const res = await syncQaseNow(props.projectId);
      if (!res.ok) return setError(res.error);
      const parts = [`${res.sent} sent`, `${res.brought} new from Qase`];
      if (res.linked) parts.push(`${res.linked} ${res.linked === 1 ? "case" : "cases"} linked by title`);
      setNote(res.skipped || `Synced with Qase: ${parts.join(", ")}.`);
      router.refresh();
    });

  const loadRuns = () =>
    start(async () => {
      setError(null);
      const res = await qaseRuns(props.projectId);
      if (!res.ok) return setError(res.error);
      setRuns(res.runs);
    });

  const pickRun = (v: string) =>
    start(async () => {
      setError(null);
      const res = await setQaseRun(props.projectId, v === "new" ? "new" : Number(v));
      if (!res.ok) return setError(res.error);
      setRuns(null);
      setNote(v === "new" ? "A new Qase run named after this test cycle is ready." : "Now sharing with that Qase run.");
      router.refresh();
    });

  return (
    <div className={cx("mb-5 rounded-lg px-4 py-3 text-sm", problem ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-950")} data-testid="qase-bar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1" suppressHydrationWarning>
          {problem ? (
            <>
              <b>Qase sharing needs a look:</b> {problem}
            </>
          ) : props.runTitle ? (
            <>
              <b className="text-emerald-700">✓ Shared with Qase</b> run &ldquo;{props.runTitle}&rdquo;{props.syncedAt ? ` · updated ${relativeTime(new Date(props.syncedAt), spelling)}` : ""}
            </>
          ) : (
            <>
              <b className="text-emerald-700">Shares with Qase.</b> A Qase run named after this test cycle is made with the first linked result.
            </>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {props.canSync && (
            <Button size="sm" onClick={sync} disabled={pending} data-howto="qase-sync-now">
              {pending ? "Syncing…" : "Sync now"}
            </Button>
          )}
          {props.canChangeRun && !runs && (
            <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onClick={loadRuns} disabled={pending} data-howto="qase-change-run">
              Change Qase run
            </button>
          )}
          <a href={props.runUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-accent-700 hover:underline">
            Open in Qase ↗
          </a>
        </span>
      </div>
      {runs && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={`qase-run-${props.projectId}`} className="text-xs">
            Share with
          </label>
          <Select id={`qase-run-${props.projectId}`} className="w-auto min-w-72 max-w-full" defaultValue="" disabled={pending} onChange={(e) => e.target.value && pickRun(e.target.value)}>
            <option value="">Pick a Qase run…</option>
            <option value="new">A new run named after this test cycle</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} (run {r.id})
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => setRuns(null)}>
            Cancel
          </Button>
        </div>
      )}
      {note && (
        <p className="mt-1.5 text-xs" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
