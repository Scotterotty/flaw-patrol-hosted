"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { longDate, SPELLINGS, spell, type Spelling } from "@/lib/spelling";
import { updateMySpelling } from "@/server/account";
import { useZone } from "./spelling";
import { cx, ErrorText } from "./ui";

const option = (selected: boolean) =>
  cx("cursor-pointer rounded-lg border p-3 text-left", selected ? "border-accent-600 ring-2 ring-accent-500/30" : "border-slate-200 hover:border-slate-300");

/** US or UK English for the app's own words and dates. Saves to your account and redraws the app. */
export function LanguageSettings({ mine }: { mine: Spelling | null }) {
  // Today on your own clock, so the sample date doesn't change as the page loads.
  const zone = useZone();
  const router = useRouter();
  const [pick, setPick] = useState<Spelling>(mine ?? "us");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const save = (s: Spelling) => {
    setPick(s);
    start(async () => {
      const res = await updateMySpelling(s);
      setError(res.ok ? null : res.error);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div role="radiogroup" aria-label="Spelling" className="grid gap-2 sm:grid-cols-2">
        {SPELLINGS.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={pick === o.id} onClick={() => save(o.id)} className={option(pick === o.id)}>
            <span className="block text-sm font-semibold text-slate-900">{o.label}</span>
            <span className="block text-xs text-slate-500">{o.sample}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Changes the app&apos;s own words and dates for you only. Test cases, steps, comments and Jira bugs stay exactly as people wrote them.
        {!mine && " US English is used until you pick."}
      </p>
      <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600" aria-label="Preview">
        <span className="font-medium text-slate-800">Preview: </span>
        {spell(`Accent color · Gray text · Organize folders · Canceled · ${longDate(new Date(), pick, zone)}`, pick)}
      </p>
    </div>
  );
}
