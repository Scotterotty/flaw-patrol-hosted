import Link from "next/link";
import { fieldBits } from "@/lib/run-fields";
import type { Severity } from "@prisma/client";
import type { ReactNode } from "react";
import { SessionFindings } from "@/components/session-findings";
import { HistoryStrip, StatusBar, StatusChip, StatusLegend } from "@/components/status";
import { PassRateTrend } from "@/components/trend-chart";
import { BugsOverTime, PassRateOverTime, ReleaseTrends, ResultsOverTime, SplitPassRate, TrendTable } from "@/components/trend-charts";
import { Badge, Card, cx, EmptyState } from "@/components/ui";
import { NOTE_KINDS, NOTE_LABEL, type NoteKind } from "@/lib/charter";
import type { sessionFindings, FindingTotals } from "@/lib/findings";
import { count, relativeTime } from "@/lib/format";
import type { caseHealth, defectReport, RunKind, RunRow, runReport, StepHistory, suiteReport, Trends } from "@/lib/reports";
import { manualLine, splitProgress } from "@/lib/progress-split";
import { mySpelling } from "@/lib/session";
import { AE_SCALE, type SeverityScale } from "@/lib/severity";
import { pct, STATUS_LABEL, STATUSES, totals, type StatusCounts } from "@/lib/status";
import type { PartId } from "@/lib/report-parts";
import { PartTitle } from "@/components/report-part-title";

/** `only`: inside a custom report (ver_101), show just this part of the view. */
const shows = (only: PartId | undefined) => (p: PartId) => !only || only === p;

// The report views, shared by a test cycle's Reports and an umbrella's Reports.

/** "R12", or "Web R12" when the runs come from several test cycles, whose run numbers repeat. */
function runLabel(r: Pick<RunRow, "number" | "projectKey" | "platform" | "projectName">, all: Pick<RunRow, "projectKey">[]) {
  const multi = all.some((x) => x.projectKey !== all[0]?.projectKey);
  return multi ? `${r.platform || r.projectName} R${r.number}` : `R${r.number}`;
}

/** Where a run's results came from, for the Type column. */
function RunType({ r }: { r: Pick<RunRow, "source" | "githubRunNo" | "sourceFile"> }) {
  if (r.source === "manual") return <Badge tone="blue">✋ Manual</Badge>;
  return <Badge tone="teal">{r.source === "github" ? "🤖 GitHub" : "🤖 Uploaded"}</Badge>;
}

function runOrigin(r: Pick<RunRow, "source" | "githubRunNo" | "sourceFile">) {
  if (r.source === "manual") return "Tested by hand";
  if (r.source === "github") return r.githubRunNo ? `Pulled from GitHub, run #${r.githubRunNo}` : "Pulled from GitHub";
  return r.sourceFile ? `Uploaded file ${r.sourceFile}` : "Uploaded results file";
}

/** All runs, only runs tested by hand, or only automated ones. Kept in the link and in saved views. */
export function RunKindFilter({ current, href }: { current: RunKind | undefined; href: (runs: RunKind | undefined) => string }) {
  const opts: { id: RunKind | undefined; label: string }[] = [
    { id: undefined, label: "All" },
    { id: "manual", label: "✋ Manual" },
    { id: "automated", label: "🤖 Automated" },
    { id: "bash", label: "🐞 Bug bash" },
  ];
  return (
    <div role="group" aria-label="Runs" className="mb-px flex items-center gap-0.5 rounded-full bg-surface p-0.5 text-xs ring-1 ring-slate-200 ring-inset">
      <span className="px-2 text-slate-500">Runs</span>
      {opts.map((o) => (
        <Link
          key={o.label}
          href={href(o.id)}
          aria-current={current === o.id ? "true" : undefined}
          className={cx("rounded-full px-2.5 py-1", current === o.id ? "bg-accent-50 font-medium text-accent-700 ring-1 ring-accent-300 ring-inset" : "text-slate-700 hover:bg-slate-50")}
        >
          {o.label}
        </Link>
      ))}
      <input type="hidden" name="runs" value={current ?? ""} />
    </div>
  );
}

export function TrendsView({ data, only }: { data: Trends; only?: PartId }) {
  const show = shows(only);
  const per = data.unit === "day" ? "day" : data.unit === "week" ? "week" : "month";
  if (data.results === 0) return <EmptyState title="No saved results match these filters">Widen the dates or clear the filters.</EmptyState>;
  return (
    <div className="space-y-5">
      {show("trends.passrate") && <Card className="p-4">
        <PartTitle part="trends.passrate">Pass rate per {per}</PartTitle>
        <p className="mb-2 text-xs text-slate-500">Cases that passed, out of those with a verdict. Each case counts once per run.{data.manual && data.automated ? " Hand testing and automation have a line each." : ""}</p>
        {data.manual > 0 && data.automated > 0 ? <SplitPassRate buckets={data.buckets} /> : <PassRateOverTime buckets={data.buckets} />}
      </Card>}
      {show("trends.results") && <Card className="p-4">
        <PartTitle part="trends.results" className="mb-2">Results per {per}</PartTitle>
        <ResultsOverTime buckets={data.buckets} />
      </Card>}
      {show("trends.bugs") && <Card className="p-4">
        <PartTitle part="trends.bugs" className="mb-2">Bugs found per {per}</PartTitle>
        <BugsOverTime buckets={data.buckets} />
        <div className="mt-3" data-export-skip="">
          <TrendTable buckets={data.buckets} />
        </div>
      </Card>}
      {show("trends.releases") && <Card className="p-4">
        <PartTitle part="trends.releases" className="mb-2">By release</PartTitle>
        <ReleaseTrends releases={data.releases} />
      </Card>}
    </div>
  );
}

export function FindingsView({
  projectId,
  projectKey,
  data,
  kinds,
  openOnly,
  qs,
  canAnswer,
  canWrite,
}: {
  projectId: string;
  projectKey: string;
  data: Awaited<ReturnType<typeof sessionFindings>>;
  kinds: NoteKind[];
  openOnly: boolean;
  qs: (extra: Record<string, string | undefined>) => string;
  canAnswer: boolean;
  canWrite: boolean;
}) {
  const t: FindingTotals = data.totals;
  if (t.sessions === 0) return <EmptyState title="No exploratory sessions in this range">Run a charter, or widen the dates.</EmptyState>;
  const hours = Math.floor(t.seconds / 3600);
  const mins = Math.round((t.seconds % 3600) / 60);
  const toggle = (k: NoteKind) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    return `?${qs({ kinds: next.join(",") || undefined, open: undefined })}`;
  };
  const chip = (on: boolean) => cx("rounded-full px-3 py-1 text-xs ring-1 ring-inset", on ? "bg-accent-50 font-medium text-accent-700 ring-accent-300" : "text-slate-600 ring-slate-200 hover:bg-slate-50");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-5">
        <Tile label="Sessions" value={String(t.sessions)} />
        <Tile label="Bugs" value={String(t.bugs)} />
        <Tile label="Open questions" value={String(t.openQuestions)} sub={`of ${t.questions}`} />
        <Tile label="Ideas" value={String(t.ideas)} />
        <Tile label="Time explored" value={t.seconds > 0 && t.seconds < 60 ? "Under 1 min" : hours ? `${hours}h ${mins}m` : `${mins}m`} />
      </div>
      <nav aria-label="Finding types" className="flex flex-wrap gap-1.5">
        <Link href={`?${qs({ kinds: undefined, open: undefined })}`} className={chip(!kinds.length && !openOnly)} aria-current={!kinds.length && !openOnly ? "true" : undefined}>
          All
        </Link>
        {NOTE_KINDS.map((k) => (
          <Link key={k} href={toggle(k)} className={chip(kinds.includes(k) && !openOnly)} aria-current={kinds.includes(k) && !openOnly ? "true" : undefined}>
            {NOTE_LABEL[k]}s
          </Link>
        ))}
        <Link href={`?${qs({ open: openOnly ? undefined : "1", kinds: undefined })}`} className={chip(openOnly)} aria-current={openOnly ? "true" : undefined}>
          Open questions
        </Link>
      </nav>
      {data.groups.length === 0 ? (
        <EmptyState title="Nothing matches">Pick other types or clear the filters.</EmptyState>
      ) : (
        <SessionFindings projectId={projectId} projectKey={projectKey} groups={data.groups} canAnswer={canAnswer} canWrite={canWrite} />
      )}
    </div>
  );
}

export function Tile({ label, value, sub, children, warn }: { label: string; value: string; sub?: string; children?: ReactNode; warn?: boolean }) {
  return (
    <Card className={cx("p-4", warn && "ring-1 ring-amber-400")}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums", warn ? "text-amber-600" : "text-slate-900")}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
      {children}
    </Card>
  );
}

function KindSplit({ manual, auto }: { manual: string; auto: string }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <Badge tone="blue">✋ {manual}</Badge>
      <Badge tone="teal">🤖 {auto}</Badge>
    </div>
  );
}

/** Yellow notice when nobody has tested by hand yet but automation has results (ver_95). */
export function NoManualBanner({ total }: { total: number }) {
  return (
    <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="no-manual-banner">
      <span aria-hidden>⚠</span>
      <p>
        <b>No manual testing yet.</b> {total ? `0 of ${total} ${total === 1 ? "case has" : "cases have"} been tested by hand. ` : ""}Everything below that passed came from automation.
      </p>
    </div>
  );
}

/** Two bars, one per side, so hand testing and automation are never added together (ver_95). */
function SplitBars({ manual, auto, autoAll, autoRuns }: { manual: StatusCounts | null; auto: StatusCounts | null; autoAll: StatusCounts; autoRuns: number }) {
  const all = totals(autoAll);
  return (
    <div className="space-y-4">
      {manual && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">✋ Manual testing · {count(totals(manual).total, "case")}</p>
          <StatusBar counts={manual} height="h-3" />
          <div className="mt-1.5">
            <StatusLegend counts={manual} />
          </div>
        </div>
      )}
      {auto && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">🤖 Automated tests · {count(totals(auto).total, "case")} (latest result)</p>
          <StatusBar counts={auto} height="h-3" />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusLegend counts={auto} />
            {autoRuns > 1 && (
              <span className="text-xs text-slate-500">
                Across {autoRuns === 1 ? "1 run" : `all ${autoRuns} runs`}: {autoAll.PASSED} passed, {autoAll.FAILED} failed ({pct(all.passRate)})
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** `suiteKey`: the project whose page each suite links to (the umbrella's hub on its Reports). */
export function StatusView({ suiteKey, runs, suites, kind, only }: { suiteKey: string; runs: Awaited<ReturnType<typeof runReport>>; suites: Awaited<ReturnType<typeof suiteReport>>; kind?: RunKind; only?: PartId }) {
  const show = shows(only);
  const { manual, auto } = splitProgress(runs);
  const defects = manual.bugs + auto.bugs;
  const hand = manualLine(manual);
  const autoT = totals(auto.latest);
  // Split the headline numbers only when both kinds are in these runs.
  const mixed = manual.runs > 0 && auto.runs > 0;
  return (
    <div className="space-y-5">
      {show("status.tiles") && auto.runs > 0 && hand.tested === 0 && kind !== "automated" && <NoManualBanner total={hand.total} />}
      {show("status.tiles") && <div>
      <PartTitle part="status.tiles" quiet>Summary numbers</PartTitle>
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Runs" value={String(runs.length)} sub={mixed ? undefined : `${runs.filter((r) => r.state === "ACTIVE").length} still open`}>
          {mixed && <KindSplit manual={`${manual.runs} manual`} auto={`${auto.runs} automated`} />}
        </Tile>
        {manual.runs > 0 && <Tile label="✋ Manual testing" value={`${hand.tested} of ${hand.total}`} sub={`tested by hand · ${hand.done}% done`} warn={hand.tested === 0} />}
        {auto.runs > 0 && <Tile label="🤖 Automated tests" value={`${auto.latest.PASSED} of ${auto.cases}`} sub={autoT.tested ? "passed on their latest run" : "no results yet"} />}
        <Tile label="Bugs found" value={String(defects)}>
          {mixed && <KindSplit manual={String(manual.bugs)} auto={String(auto.bugs)} />}
        </Tile>
      </div>
      </div>}
      {show("status.cases") && <Card className="p-4">
        <PartTitle part="status.cases" className="mb-2">Cases in these runs</PartTitle>
        <SplitBars manual={manual.runs ? manual.counts : null} auto={auto.runs ? auto.latest : null} autoAll={auto.counts} autoRuns={auto.runs} />
      </Card>}
      {show("status.passrate") && <Card className="p-4">
        <PartTitle part="status.passrate" className="mb-2">Pass rate by run</PartTitle>
        <PassRateTrend
          points={[...runs].reverse().map((r) => ({
            label: runLabel(r, runs),
            detail: `${r.name}${r.release ? `, ${r.release}` : ""}. ${runOrigin(r)}.`,
            value: totals(r.counts).passRate,
            automated: r.source !== "manual",
          }))}
        />
      </Card>}
      {show("status.suites") && <Card className="overflow-x-auto" data-export-skip="">
        <PartTitle part="status.suites" className="border-b border-slate-200 px-4 py-3">Test suites</PartTitle>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Suite</th>
              <th className="px-4 py-2 font-medium">Runs</th>
              <th className="w-64 px-4 py-2 font-medium">Latest run</th>
              <th className="px-4 py-2 text-right font-medium">Passed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {suites.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                  No test suites yet. Runs started from picked cases or the whole library show in the runs list below.
                </td>
              </tr>
            )}
            {suites.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2">
                  <Link href={`/p/${suiteKey}/suites/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>{" "}
                  <span className="text-xs text-slate-500">v{s.version} · {count(s.cases, "case")}</span>
                </td>
                <td className="px-4 py-2 tabular-nums">{s.runs}</td>
                <td className="px-4 py-2">
                  {s.latest ? (
                    <>
                      <StatusBar counts={s.latest.counts} />
                      <p className="mt-0.5 text-xs text-slate-500">
                        {runLabel(s.latest, runs)} {s.latest.release && `· ${s.latest.release}`} · {Math.round(totals(s.latest.counts).progress * 100)}% done
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">Not run in this range</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{s.latest ? pct(totals(s.latest.counts).passRate) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>}
      {show("status.runs") && <RunsTable runs={runs} />}
    </div>
  );
}

export async function RunsTable({ runs }: { runs: Awaited<ReturnType<typeof runReport>> }) {
  const spelling = await mySpelling();
  return (
    <Card className="overflow-x-auto" data-export-skip="">
      <PartTitle part="status.runs" className="border-b border-slate-200 px-4 py-3">Runs</PartTitle>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Run</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Release</th>
            <th className="w-56 px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">Passed</th>
            <th className="px-4 py-2 text-right font-medium">Failed</th>
            <th className="px-4 py-2 text-right font-medium">Blocked</th>
            <th className="px-4 py-2 text-right font-medium">Bugs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {runs.map((r) => (
            <tr key={`${r.projectKey}-${r.number}`}>
              <td className="px-4 py-2">
                <Link href={`/p/${r.projectKey}/runs/${r.number}`} className="hover:underline">
                  <span className="font-mono text-xs text-slate-500">{runLabel(r, runs)}</span> {r.name}
                </Link>
                <p className="text-xs text-slate-500">
                  {[r.suite && `${r.suite}${r.suiteVersion ? ` v${r.suiteVersion}` : ""}`, r.build && `build ${r.build}`, ...fieldBits(r), relativeTime(r.createdAt, spelling)].filter(Boolean).join(" · ")}
                </p>
              </td>
              <td className="px-4 py-2 whitespace-nowrap">
                <RunType r={r} />
              </td>
              <td className="px-4 py-2 text-xs">{r.release || "–"}</td>
              <td className="px-4 py-2">
                <StatusBar counts={r.counts} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{pct(totals(r.counts).passRate)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.counts.FAILED}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.counts.BLOCKED}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.defects}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function StepsView({ runs, stepCounts, failing, moreHref, only }: { runs: Awaited<ReturnType<typeof runReport>>; stepCounts: StatusCounts; failing: StepHistory[]; moreHref: string; only?: PartId }) {
  const show = shows(only);
  const t = totals(stepCounts);
  const { manual, auto } = splitProgress(runs);
  const mixed = manual.runs > 0 && auto.runs > 0;
  return (
    <div className="space-y-5">
      {show("steps.tiles") && <div>
      <PartTitle part="steps.tiles" quiet>Step numbers</PartTitle>
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Steps executed" value={String(t.tested)}>
          {mixed && <KindSplit manual={`${totals(manual.steps).tested} by hand`} auto={`${totals(auto.steps).tested} automated`} />}
        </Tile>
        <Tile label="Passed steps" value={String(stepCounts.PASSED)} sub={pct(t.passRate)} />
        <Tile label="Failed steps" value={String(stepCounts.FAILED)} />
        <Tile label="Blocked" value={String(stepCounts.BLOCKED)} />
      </div>
      </div>}
      {show("steps.outcomes") && <Card className="p-4">
        <PartTitle part="steps.outcomes" className="mb-2" title="Step outcomes">Step outcomes (latest result of each case)</PartTitle>
        {mixed ? (
          // Hand testing and automation on their own bars (ver_95).
          <div className="space-y-4">
            {(
              [
                ["✋ Manual testing", manual.steps],
                ["🤖 Automated tests", auto.steps],
              ] as const
            ).map(([label, counts]) => (
              <div key={label}>
                <p className="mb-1 text-xs font-medium text-slate-700">
                  {label} · {count(totals(counts).tested, "step")}
                </p>
                <StatusBar counts={counts} height="h-3" />
                <div className="mt-1.5">
                  <StatusLegend counts={counts} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <StatusBar counts={stepCounts} height="h-3" />
            <div className="mt-2">
              <StatusLegend counts={stepCounts} />
            </div>
          </>
        )}
      </Card>}
      {show("steps.byrun") && <Card className="overflow-x-auto" data-export-skip="">
        <PartTitle part="steps.byrun" className="border-b border-slate-200 px-4 py-3">Steps by run</PartTitle>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Run</th>
              <th className="px-4 py-2 font-medium">Type</th>
              {(["PASSED", "FAILED", "BLOCKED", "SKIPPED"] as const).map((s) => (
                <th key={s} className="px-4 py-2 text-right font-medium">
                  {STATUS_LABEL[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((r) => (
              <tr key={`${r.projectKey}-${r.number}`}>
                <td className="px-4 py-2">
                  <Link href={`/p/${r.projectKey}/runs/${r.number}`} className="hover:underline">
                    <span className="font-mono text-xs text-slate-500">{runLabel(r, runs)}</span> {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <RunType r={r} />
                </td>
                {(["PASSED", "FAILED", "BLOCKED", "SKIPPED"] as const).map((s) => (
                  <td key={s} className="px-4 py-2 text-right tabular-nums">
                    {r.steps[s]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>}
      {show("steps.failmost") && <Card className="overflow-x-auto" data-export-skip="">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <PartTitle part="steps.failmost" className="flex-1">Steps that fail most</PartTitle>
          {!only && (
            <Link href={moreHref} className="text-sm text-accent-700 hover:underline">
              Full failure history
            </Link>
          )}
        </div>
        {/* Only steps that have failed at least once (ver_91). */}
        {failing.filter((r) => r.failures > 0).length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No failed steps in this range.</p>
        ) : (
          <FailingTable rows={failing.filter((r) => r.failures > 0)} />
        )}
      </Card>}
    </div>
  );
}

export function DefectsView({ rows: all, scale = AE_SCALE, only, critical }: { rows: Awaited<ReturnType<typeof defectReport>>; scale?: SeverityScale; only?: PartId; critical?: boolean }) {
  const show = shows(only);
  // "Critical only" is a custom report part's own filter (ver_101).
  const rows = critical ? all.filter((r) => (scale.critical as string[]).includes(r.severity)) : all;
  const open = rows.filter((r) => r.open).length;
  const sev = (s: string) => rows.filter((r) => r.severity === s).length;
  return (
    <div className="space-y-5">
      {show("defects.tiles") && <div>
      <PartTitle part="defects.tiles" quiet>Bug numbers</PartTitle>
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Bugs found" value={String(rows.length)} />
        <Tile label="Still open" value={String(open)} />
        <Tile label="Fixed or closed" value={String(rows.length - open)} />
        <Tile label="Critical" value={String(scale.critical.reduce((n, s) => n + sev(s), 0))} sub={scale.critical.map((s) => scale.labels[s]).join(", ")} />
      </div>
      </div>}
      {show("defects.list") && <Card className="overflow-x-auto" data-export-skip="">
        <PartTitle part="defects.list" className="border-b border-slate-200 px-4 py-3">Bug list</PartTitle>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No bugs were linked to results in this range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Bug</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Severity</th>
                <th className="px-4 py-2 font-medium">Found in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.key} className="align-top">
                  <td className="px-4 py-2">
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium text-accent-700 hover:underline">
                        {d.key}
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-slate-500">{d.key}</span>
                    )}{" "}
                    {d.title}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={d.open ? "red" : "green"}>{d.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap">{scale.labels[d.severity as Severity] ?? d.severity}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {d.foundIn.map((x, i) => (
                      <p key={i}>
                        {x.caseKey}
                        {x.step !== null && ` step ${x.step}`} · R{x.run}
                        {x.release && ` · ${x.release}`}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>}
    </div>
  );
}

export async function CasesView({ rows, only }: { rows: Awaited<ReturnType<typeof caseHealth>>; only?: PartId }) {
  const show = shows(only);
  const spelling = await mySpelling();
  const failing = rows.filter((r) => r.failStreak > 0).sort((a, b) => b.failStreak - a.failStreak).slice(0, 15);
  const flaky = rows.filter((r) => r.flips >= 2).sort((a, b) => b.flips - a.flips).slice(0, 15);
  const all = [...rows].sort((a, b) => (a.passRate ?? 2) - (b.passRate ?? 2));
  const Row = ({ r, extra }: { r: (typeof rows)[number]; extra: string }) => (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <Link href={`/p/${r.caseProjectKey}/cases/${r.number}`} className="min-w-0 flex-1 truncate hover:underline">
        <span className="font-mono text-xs text-slate-500">{r.caseKey}</span> {r.title}
      </Link>
      <span className="text-xs whitespace-nowrap text-slate-500">{extra}</span>
    </li>
  );
  return (
    <div className="space-y-5">
      {!only && <p className="text-sm text-slate-600">Open any case for its full execution history across every run, release and build.</p>}
      <div className={cx("grid gap-5", !only && "md:grid-cols-2", only && !show("cases.failing") && !show("cases.flaky") && "hidden")}>
        {show("cases.failing") && <Card className="p-4">
          <PartTitle part="cases.failing" className="mb-1">Failing now</PartTitle>
          <p className="mb-2 text-xs text-slate-500">Most recent result failed, longest streak first.</p>
          {failing.length ? <ul className="divide-y divide-slate-100">{failing.map((r) => <Row key={r.caseKey} r={r} extra={`failed ${r.failStreak}× in a row`} />)}</ul> : <p className="text-sm text-slate-500">None.</p>}
        </Card>}
        {show("cases.flaky") && <Card className="p-4">
          <PartTitle part="cases.flaky" className="mb-1">Flaky</PartTitle>
          <p className="mb-2 text-xs text-slate-500">Flipped between passed and failed at least twice.</p>
          {flaky.length ? <ul className="divide-y divide-slate-100">{flaky.map((r) => <Row key={r.caseKey} r={r} extra={`${r.flips} flips`} />)}</ul> : <p className="text-sm text-slate-500">None.</p>}
        </Card>}
      </div>
      {show("cases.all") && <Card className="overflow-x-auto" data-export-skip="">
        <PartTitle part="cases.all" className="border-b border-slate-200 px-4 py-3" title="Every case executed">Every case executed ({rows.length})</PartTitle>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Case</th>
              <th className="px-4 py-2 text-right font-medium">Executions</th>
              <th className="px-4 py-2 text-right font-medium">Passed</th>
              <th className="px-4 py-2 font-medium">Latest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {all.map((r) => (
              <tr key={r.caseKey}>
                <td className="px-4 py-2">
                  <Link href={`/p/${r.caseProjectKey}/cases/${r.number}`} className="hover:underline">
                    <span className="font-mono text-xs text-slate-500">{r.caseKey}</span> {r.title}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.runs}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pct(r.passRate)}</td>
                <td className="px-4 py-2">
                  <StatusChip status={r.last} /> <span className="text-xs text-slate-500">{relativeTime(r.lastAt, spelling)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>}
    </div>
  );
}

export function FailingView({ rows, allTimeHref, only }: { rows: StepHistory[]; allTimeHref: string | null; only?: PartId }) {
  const show = shows(only);
  const failingNow = rows.filter((r) => r.streak > 0).length;
  const failures = rows.reduce((n, r) => n + r.failures, 0);
  return (
    <div className="space-y-5">
      {show("failing.tiles") && <div>
      <PartTitle part="failing.tiles" quiet>Failing step numbers</PartTitle>
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Steps that failed" value={String(rows.filter((r) => r.failures > 0).length)} sub="at least once" />
        <Tile label="Step failures" value={String(failures)} sub="failed steps" />
        <Tile label="Failing now" value={String(failingNow)} sub="failed in their latest run" />
        <Tile label="Most failures" value={rows[0]?.failures ? String(rows[0].failures) : "0"} sub={rows[0]?.failures ? `${rows[0].caseKey} step ${rows[0].step}` : undefined} />
      </div>
      </div>}
      {show("failing.history") && <Card className="overflow-x-auto" data-export-skip="">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex-1">
            <PartTitle part="failing.history">Failure history by step</PartTitle>
            <p className="text-xs text-slate-500">Most failures first. Each square is one run, oldest on the left; hover for the run.</p>
          </div>
          {allTimeHref && !only && (
            <Link href={allTimeHref} className="text-sm text-accent-700 hover:underline">
              Show all time
            </Link>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No step has failed or been blocked in this range.</p>
        ) : (
          <FailingTable rows={rows} full />
        )}
      </Card>}
    </div>
  );
}

export async function FailingTable({ rows, full }: { rows: StepHistory[]; full?: boolean }) {
  const spelling = await mySpelling();
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs text-slate-500">
        <tr>
          <th className="px-4 py-2 font-medium">Step</th>
          <th className="px-4 py-2 font-medium">History</th>
          <th className="px-4 py-2 text-right font-medium">Failures</th>
          <th className="px-4 py-2 text-right font-medium">Fail rate</th>
          {full && <th className="px-4 py-2 text-right font-medium">Blocked</th>}
          <th className="px-4 py-2 font-medium">Last failed</th>
          {full && <th className="px-4 py-2 font-medium">Bugs</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((s, i) => (
          <tr key={i} className="align-top">
            <td className="px-4 py-2">
              <p className="text-slate-800">
                <span className="font-mono text-xs text-slate-500">{s.step}</span> {s.action}
              </p>
              <Link href={`/p/${s.caseProjectKey}/cases/${s.caseNumber}`} className="text-xs text-slate-500 hover:underline">
                {s.caseKey} {s.title}
              </Link>
              {s.streak > 0 && (
                <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">
                  {s.streak > 1 ? `Failing ${s.streak} runs in a row` : "Failing now"}
                </span>
              )}
            </td>
            <td className="px-4 py-2 whitespace-nowrap">
              <HistoryStrip statuses={s.history.map((h) => ({ status: h.status, title: `R${h.run}${h.release ? ` · ${h.release}` : ""}: ${STATUS_LABEL[h.status]}`, href: `/p/${h.projectKey}/runs/${h.run}` }))} max={full ? 30 : 15} />
            </td>
            <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
              {s.failures} <span className="text-xs text-slate-400">of {s.runs}</span>
            </td>
            <td className="px-4 py-2 text-right tabular-nums">{pct(s.failRate)}</td>
            {full && <td className="px-4 py-2 text-right tabular-nums">{s.blocked}</td>}
            <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-600">
              {s.lastFailed ? (
                <>
                  <Link href={`/p/${s.lastFailed.projectKey}/runs/${s.lastFailed.run}`} className="hover:underline">
                    R{s.lastFailed.run}
                  </Link>
                  {s.lastFailed.release && ` · ${s.lastFailed.release}`} · {relativeTime(s.lastFailed.at, spelling)}
                </>
              ) : (
                "Never"
              )}
            </td>
            {full && <td className="px-4 py-2 font-mono text-xs text-slate-600">{s.bugs.join(", ")}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
