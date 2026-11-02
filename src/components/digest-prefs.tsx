"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BASH_PREFS, RUN_PREFS, type DigestPrefs } from "@/lib/digest-settings";
import { saveDigestPrefs } from "@/server/digests";
import { ErrorText } from "./ui";

/** Your account → Emails I get: which digest emails come to you. Saves on each change. */
export function DigestPrefsForm({ initial }: { initial: DigestPrefs }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [, start] = useTransition();
  const change = (next: DigestPrefs) => {
    setP(next);
    setSaved(false);
    start(async () => {
      const r = await saveDigestPrefs(next);
      if (!r.ok) return setError(r.error);
      setError(null);
      setSaved(true);
      router.refresh();
    });
  };
  const row = <T extends string>(title: string, hint: string, name: string, list: { id: T; label: string }[], value: T, set: (v: T) => void) => (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-slate-800">{title}</legend>
      <p className="text-xs text-slate-500">{hint}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {list.map((o) => (
          <label key={o.id} className="flex items-center gap-1.5">
            <input type="radio" name={name} checked={value === o.id} onChange={() => set(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="space-y-4">
      {row("Runs", "A summary when a run finishes.", "digest-runs", RUN_PREFS, p.runs, (runs) => change({ ...p, runs }))}
      {row("Bug bashes", "A summary when a bug bash ends.", "digest-bashes", BASH_PREFS, p.bashes, (bashes) => change({ ...p, bashes }))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" role="switch" checked={p.rc} onChange={(e) => change({ ...p, rc: e.target.checked })} />
        <span>
          <span className="font-medium text-slate-800">Release testing done</span>
          <span className="block text-xs text-slate-500">When every platform&apos;s run for a release is done.</span>
        </span>
      </label>
      <p className="text-xs text-slate-500">
        Invites and password emails always come. All runs means every run in the umbrellas you belong to, once the team turns on email digests. Runs I tested in also covers runs your team sends you, like ones you started or a group you&apos;re in.
      </p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <span role="status" className="text-xs text-emerald-700">
        {saved ? "Saved." : ""}
      </span>
    </div>
  );
}
