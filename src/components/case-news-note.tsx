"use client";

import Link from "next/link";
import type { CaseNews, StepChange } from "@/lib/case-news";
import { shortDate } from "@/lib/spelling";
import { useSpelling } from "./spelling";

// New and Updated cases in the runner (ver_96): a note above the steps, and tags on updated steps.

export function CaseNewsNote({ news, href }: { news: CaseNews | null | undefined; href?: string }) {
  const spelling = useSpelling();
  if (!news) return null;
  const day = (iso: string) => shortDate(new Date(iso), spelling);
  if (news.kind === "new")
    return (
      <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950" data-testid="case-news">
        <b>First time this case is run.</b> Added by {news.addedBy} on {day(news.addedAt)}. Read each step before you start: nobody has tried them yet. If a step is unclear or wrong, use{" "}
        <b>Flag</b> so it gets fixed.
      </div>
    );
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="case-news">
      <b>
        Updated since its last run (R{news.since.run}, {day(news.since.at)}).
      </b>{" "}
      Edited by {news.by} on {day(news.at)}: {news.what.charAt(0).toLowerCase() + news.what.slice(1)}.
      {href && (
        <>
          {" "}
          <Link href={href} className="font-medium text-accent-700 hover:underline">
            Compare with R{news.since.run}&apos;s version
          </Link>
        </>
      )}
      {news.preconditions !== null && (
        <span className="mt-1 block text-xs text-amber-900">
          {news.preconditions ? (
            <>
              Preconditions before: <span className="line-through">{news.preconditions}</span>
            </>
          ) : (
            "The preconditions are new."
          )}
        </span>
      )}
    </div>
  );
}

/** "Reworded" with the old wording struck through, or "New step". */
export function StepChangeTag({ change }: { change?: StepChange }) {
  if (!change) return null;
  if (change.kind === "new")
    return <span className="mb-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 select-none">New step</span>;
  return (
    <span className="mb-1 block select-none">
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">Reworded</span>{" "}
      <span className="text-xs text-slate-500 line-through" title="How the step read in its last run">
        {change.action}
      </span>
    </span>
  );
}
