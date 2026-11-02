"use client";

import Link from "next/link";
import { useState } from "react";
import { Input } from "./ui";
import { CloseMatchesLabel } from "./close-matches";
import { forgivingFilter } from "@/lib/fuzzy";

export type PastQuestRow = { number: number; name: string; release: string; from: string; to: string; steps: number; position: number; found: number };

/** Older finished quests as a compact list, collapsed until opened, with a search box. */
export function PastQuests({ projectKey, rows }: { projectKey: string; rows: PastQuestRow[] }) {
  const [query, setQuery] = useState("");
  // Forgiving search: exact matches, then close ones under their own label.
  const found = forgivingFilter(rows, query, (r) => `r${r.number} ${r.name} ${r.release} ${r.from} ${r.to}`);
  const shown = [...found.exact, ...found.close];
  const closeStart = found.close.length ? found.exact.length : -1;
  return (
    <details className="group rounded-lg border border-slate-200 bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 hover:text-slate-900">
        <span className="inline-block transition group-open:rotate-90" aria-hidden>
          ▸
        </span>{" "}
        Older quests ({rows.length})
      </summary>
      <div className="border-t border-slate-200 p-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by run, name, release or place"
          aria-label="Search older quests"
          className="mb-2 max-w-sm"
        />
        {shown.length === 0 ? (
          <p className="px-1 py-2 text-sm text-slate-500">No older quests match.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-slate-100 overflow-auto text-sm">
            {shown.map((r, i) => (
              <li key={r.number}>
                {i === closeStart && (
                  <>
                    {closeStart === 0 && <p className="px-1 pt-1.5 text-xs text-slate-500">No exact matches.</p>}
                    <CloseMatchesLabel className="px-0" />
                  </>
                )}
                <Link href={`/p/${projectKey}/quests/${r.number}`} className="flex items-baseline gap-3 rounded px-1 py-2 hover:bg-slate-50">
                  <span className="w-12 shrink-0 font-mono text-xs text-slate-500">R{r.number}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-800">
                    {r.name}
                    {r.release && <span className="text-slate-500"> · {r.release}</span>}
                  </span>
                  <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">
                    {r.from} to {r.to}
                  </span>
                  <span className="w-28 shrink-0 text-right text-xs text-slate-500 tabular-nums">
                    {r.position >= r.steps && r.steps > 0 ? "Arrived" : `${r.position} of ${r.steps}`} · {r.found} found
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
