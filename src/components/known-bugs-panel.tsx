import type { KnownBug } from "@/lib/known-bugs";
import { runTitle } from "@/lib/run-label";
import { relativeTime } from "@/lib/format";
import type { Spelling } from "@/lib/spelling";
import { KnownStatus } from "./known-bugs";
import { Card } from "./ui";

// Known bugs on the run page: a heads-up line and the list with this run's checks.

export type RunKnown = { bug: KnownBug; caseKey: string };

export function KnownBugsHeadsUp({ list }: { list: RunKnown[] }) {
  const bugs = new Set(list.map((k) => k.bug.id)).size;
  const cases = new Set(list.map((k) => k.caseKey)).size;
  if (!bugs) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="known-heads-up">
      <span aria-hidden>🐞</span>
      <span className="flex-1">
        <b>
          {bugs} known {bugs === 1 ? "bug" : "bugs"}
        </b>{" "}
        from earlier runs {bugs === 1 ? "touches" : "touch"} {cases} {cases === 1 ? "case" : "cases"} in this run. Each case shows them before you start.
      </span>
      <a href="#known-bugs" className="text-xs font-medium text-accent-700 hover:underline">
        See the list
      </a>
    </div>
  );
}

export function KnownBugsPanel({ list, spelling }: { list: RunKnown[]; spelling: Spelling }) {
  if (!list.length) return null;
  const live = list.filter((k) => k.bug.state !== "expected");
  const still = live.filter((k) => k.bug.check?.outcome === "still").length;
  const gone = live.filter((k) => k.bug.check?.outcome === "gone").length;
  const unchecked = live.length - still - gone;
  return (
    <Card id="known-bugs" className="mb-5 scroll-mt-20 p-4" data-testid="known-bugs-panel">
      <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Known bugs <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 normal-case">{new Set(list.map((k) => k.bug.id)).size}</span>
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">What this run has found out about them so far.</p>
      <p className="mt-2 flex flex-wrap gap-1.5 text-xs font-medium">
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">{still} still {still === 1 ? "happens" : "happen"}</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">{gone} didn&apos;t happen</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{unchecked} not checked yet</span>
      </p>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {list.map(({ bug: b, caseKey }) => (
          <li key={`${b.id}-${caseKey}`} className="py-2">
            <span className="flex flex-wrap items-center gap-1.5">
              {b.url ? (
                <a href={b.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold text-accent-700 hover:underline">
                  {b.key}
                </a>
              ) : (
                <span className="font-mono text-xs font-semibold">{b.key}</span>
              )}
              <span className="text-slate-900">{b.title}</span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <KnownStatus bug={b} />
              <span className="font-mono">{caseKey}</span>·
              {b.state === "expected" ? (
                <span>Expected, no check needed</span>
              ) : b.check ? (
                <span>
                  <span className={b.check.outcome === "still" ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{b.check.outcome === "still" ? "Still happens" : "Didn't happen"}</span> ({b.check.by},{" "}
                  <span suppressHydrationWarning>{relativeTime(new Date(b.check.at), spelling)}</span>)
                </span>
              ) : (
                <span>Not checked yet</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The Test runs list's "N known bugs" tag. */
export function KnownCountTag({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[11px] font-semibold text-amber-900" title={`${count} ${count === 1 ? "bug" : "bugs"} from earlier runs touch cases in this run`}>
      {count} known {count === 1 ? "bug" : "bugs"}
    </span>
  );
}

export type LastCheck = { outcome: string; byName: string; createdAt: Date; run: { number: number; name: string; build: string; createdAt: Date } };

/** The Bugs page's "Last checked in R20: Still happens" line. */
export function LastCheckLine({ check, spelling }: { check?: LastCheck | null; spelling: Spelling }) {
  if (!check) return null;
  return (
    <span className="block text-xs text-slate-500">
      Last checked in {runTitle(check.run, spelling)}:{" "}
      <span className={check.outcome === "still" ? "font-medium text-red-700" : "font-medium text-emerald-700"}>{check.outcome === "still" ? "Still happens" : "Didn't happen"}</span> ({check.byName},{" "}
      <span suppressHydrationWarning>{relativeTime(check.createdAt, spelling)}</span>)
    </span>
  );
}
