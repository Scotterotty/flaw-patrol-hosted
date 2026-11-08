import Link from "next/link";
import { RunName } from "@/components/run-name";
import { runTitle } from "@/lib/run-label";
import { RunKindTag } from "@/components/run-kind-tag";
import { StatusBar } from "@/components/status";
import { LinkButton } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import type { RunKindDef } from "@/lib/run-kinds";
import { findsLine, type RunLive } from "@/lib/run-live";
import type { Spelling } from "@/lib/spelling";
import { pct, type countStatuses, type totals } from "@/lib/status";

// Runs in progress, on a test cycle's Overview and the umbrella's Overview (ver_163).
// Each run's button to test it is the biggest thing in the row, so it's the first
// thing people see; Create a run in the header steps back while runs wait.

export type ProgressRun = {
  id: string;
  number: number;
  name: string;
  build: string;
  release: string | null;
  createdAt: Date;
  counts: ReturnType<typeof countStatuses>;
  t: ReturnType<typeof totals>;
  mine: number;
  mineLeft: number;
  shown: string;
  live?: RunLive;
  /** The test cycle the run is in. */
  projectKey: string;
  /** Shown on the umbrella's Overview: which test cycle it's in. */
  cycle?: { name: string; badge: string; color: string };
};

/** The big "▶ Start testing" look: a glow ring so it stands out from every other button. */
export const GO_CLASS = "h-10 px-4 font-semibold ring-3 ring-accent-500/35 hover:ring-4 hover:ring-accent-500/50";

/** What the run's button does, or null when there's nothing for this person to do in it. */
export function runGo(r: ProgressRun, canExecute: boolean): { href: string; label: string } | null {
  const lv = r.live;
  const base = `/p/${r.projectKey}/runs/${r.number}`;
  if (lv?.type === "bash") return lv.live ? { href: `/p/${lv.homeKey}/bashes/${lv.bashId}?join=1`, label: "Join the bash" } : null;
  if (!canExecute) return null;
  if (lv?.type === "explore") return { href: `${base}/execute`, label: lv.started ? "Keep exploring" : "Start exploring" };
  if (r.t.tested >= r.t.total) return null;
  return { href: `${base}/execute${r.mineLeft ? "?mine=1" : ""}`, label: r.t.tested === 0 ? "Start testing" : "Continue testing" };
}

/** True when at least one row has a button to test with: then Create a run is the quieter button. */
export function anyGo(rows: ProgressRun[], canExecute: boolean) {
  return rows.some((r) => runGo(r, canExecute));
}

export function RunsInProgressList({ rows, kinds, canExecute, spelling }: { rows: ProgressRun[]; kinds: RunKindDef[]; canExecute: boolean; spelling: Spelling }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => {
        const lv = r.live;
        const button = runGo(r, canExecute);
        return (
          <li key={r.id} className="relative px-4 py-3 hover:bg-slate-50" data-testid="progress-run">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {r.cycle && (
                  <span aria-hidden className="grid size-6 flex-none place-items-center rounded-md text-[11px] font-semibold text-white" style={{ background: r.cycle.color }}>
                    {r.cycle.badge}
                  </span>
                )}
                <Link
                  href={`/p/${r.projectKey}/runs/${r.number}`}
                  className="min-w-0 truncate font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent-500 focus-visible:after:ring-inset"
                >
                  <RunName run={r} spelling={spelling} />
                  {r.cycle && <span className="ml-1.5 text-xs font-normal text-slate-500">in {r.cycle.name}</span>}
                </Link>
              </span>
              <span className="relative z-10 flex shrink-0 items-center gap-2">
                <RunKindTag kinds={kinds} kind={r.shown} live={lv?.type === "bash" && lv.live} />
                {button && (
                  <LinkButton variant="primary" className={GO_CLASS} href={button.href} aria-label={`${button.label} ${runTitle(r, spelling)}`} data-howto={button.label === "Join the bash" ? "bash-join" : undefined}>
                    <span aria-hidden>▶</span> {button.label}
                  </LinkButton>
                )}
              </span>
            </div>
            {lv?.type === "explore" ? (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className="h-full rounded-full bg-teal-600" style={{ width: `${lv.limitMin ? Math.min(100, (lv.usedMin / lv.limitMin) * 100) : 0}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {lv.started ? (
                    <>
                      <span className="tabular-nums">
                        {lv.usedMin} of {lv.limitMin} min
                      </span>
                      {lv.who && ` · ${lv.who}`}
                      {lv.persona && ` · as ${lv.persona.emoji} ${lv.persona.name}`} · {findsLine(lv)}
                    </>
                  ) : (
                    <>
                      Not started · {lv.limitMin} min limit{lv.persona && ` · as ${lv.persona.emoji} ${lv.persona.name}`}
                    </>
                  )}
                </p>
              </>
            ) : lv?.type === "bash" ? (
              <p className="mt-1 text-xs text-slate-500">
                {lv.live && <span className="font-medium text-rose-700">{lv.minutesLeft} min left · </span>}
                {lv.people} {lv.people === 1 ? "person" : "people"} exploring · {lv.bugs} {lv.bugs === 1 ? "bug" : "bugs"} logged · {lv.areas} {lv.areas === 1 ? "area" : "areas"} · started {relativeTime(lv.startedAt, spelling)}
              </p>
            ) : (
              <>
                <StatusBar counts={r.counts} className="mt-2" />
                <p className="mt-1 text-xs text-slate-500">
                  <span className="tabular-nums">
                    {r.t.tested} of {r.t.total} tested · {pct(r.t.passRate)} passed
                  </span>
                  {r.release && ` · ${r.release}`} · started {relativeTime(r.createdAt, spelling)}
                  {r.mine > 0 && ` · ${r.mineLeft ? `${r.mineLeft} of yours to go` : "your cases are done"}`}
                </p>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
