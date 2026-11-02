"use client";

import { useState } from "react";
import { closestVersions, matchVersion, type FoundInDraft } from "@/lib/found-in";
import { Select } from "./ui";

const WHY = { run: "From this run's release", bash: "From the bug bash's release", cycle: "From this test cycle's release name", none: "" } as const;

/**
 * The bug box's Found in line: the release being tested, already picked as the Jira
 * version. Anyone filing can change it or leave it out. A release Jira doesn't have is said in
 * words, since it goes in the description instead.
 */
export function FoundInLine({ draft, value, onChange }: { draft: FoundInDraft; value: string; onChange: (v: string) => void }) {
  const [older, setOlder] = useState(() => draft.older.includes(value));
  const all = [...draft.current, ...draft.older].map((name) => ({ name, released: false }));
  const known = !value || !!matchVersion(all, value);
  const shown = [...draft.current, ...(older ? draft.older : [])];
  const why = !value ? (draft.release ? "Not set in Jira" : "Nothing in this run says which release. Pick one, or leave it out.") : value === draft.value ? WHY[draft.source] || "Changed by you" : "Changed by you";
  return (
    <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2" data-testid="found-in">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label htmlFor="bug-found-in" className="text-sm font-medium text-slate-700">
          Found in
        </label>
        <Select id="bug-found-in" value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-40 max-w-full" title={`Goes in Jira's ${draft.label}`}>
          {value && !known && <option value={value}>{value} (not in Jira)</option>}
          {shown.map((v) => (
            <option key={v} value={v}>
              {draft.older.includes(v) ? `${v} (released)` : v}
            </option>
          ))}
          {value && known && !shown.includes(value) && <option value={value}>{value}</option>}
          <option value="">Leave it out</option>
        </Select>
        <span className="text-xs text-slate-500" data-testid="found-in-why">
          {why}
          {value && known && draft.onScreen ? ` · goes in Jira's ${draft.label}` : ""}
        </span>
        {draft.older.length > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={older} onChange={(e) => setOlder(e.target.checked)} />
            Show older versions
          </label>
        )}
      </div>
      {!known && (
        <p className="text-xs text-amber-800" data-testid="found-in-missing">
          &quot;{value}&quot; isn&apos;t a version in Jira, so it goes in the description instead.{" "}
          {closestVersions(draft).map((v) => (
            <span key={v}>
              <button type="button" className="text-accent-700 hover:underline" onClick={() => onChange(v)}>
                Use {v}
              </button>{" "}
              ·{" "}
            </span>
          ))}
          <button type="button" className="text-accent-700 hover:underline" onClick={() => onChange("")}>
            Leave it out
          </button>
        </p>
      )}
      {known && value && !draft.onScreen && (
        <p className="text-xs text-amber-800" data-testid="found-in-off-screen">
          {draft.label} isn&apos;t on the Jira create screen, so the version goes in the description. A Jira admin can add the field to the screen.
        </p>
      )}
    </div>
  );
}
