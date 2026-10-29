import type { ResultStatus } from "@prisma/client";
import type { ReleaseTrend, TrendBucket } from "@/lib/reports";
import { countStatuses, pct, STATUS_LABEL, STATUS_STYLE, STATUSES, totals } from "@/lib/status";
import { StatusBar, StatusLegend, summary } from "./status";
import { cx } from "./ui";

// Report trends: pass rate, results and bugs per period, and pass rate per
// release. One axis per chart; status colors only mean statuses.
// Hover any point or bar for its numbers; each chart has a table view.

// Drawn at roughly the width it's shown at, so axis text stays its real size.
const W = 1000;
const H = 220;
const pad = { l: 36, r: 16, t: 14, b: 24 };

/** Which x labels to print so they never collide: about eight, plus the last. */
const showLabel = (i: number, n: number) => i === n - 1 || i % Math.ceil(n / 8) === 0;

/** Pass rate per period as a line. Across periods with no verdicts the line is dashed, so a gap reads as "no data", not a change. */
export function PassRateOverTime({ buckets }: { buckets: TrendBucket[] }) {
  const withData = buckets.filter((b) => b.passRate !== null);
  if (withData.length < 2) return <p className="text-sm text-slate-500">Needs results in at least two periods to show a trend.</p>;
  const n = buckets.length;
  const x = (i: number) => pad.l + (n === 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const pts = buckets.flatMap((b, i) => (b.passRate === null ? [] : [{ i, v: b.passRate }]));
  const segs = pts.slice(1).map((p, k) => ({ a: pts[k], b: p, gap: p.i - pts[k].i > 1 }));
  const lastIdx = buckets.findLastIndex((b) => b.passRate !== null);
  const last = buckets[lastIdx];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Pass rate per period, latest ${pct(last.passRate)}`}>
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--color-slate-200)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="var(--color-slate-500)">
            {g * 100}%
          </text>
        </g>
      ))}
      {segs.map(({ a, b, gap }) => (
        <line
          key={a.i}
          x1={x(a.i)}
          y1={y(a.v)}
          x2={x(b.i)}
          y2={y(b.v)}
          stroke="var(--color-accent-600)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={gap ? "4 5" : undefined}
          opacity={gap ? 0.6 : 1}
        />
      ))}
      {buckets.map((b, i) => (
        <g key={b.key} className="group">
          {b.passRate !== null && (
            <>
              <rect x={x(i) - 10} y={pad.t} width={20} height={H - pad.t - pad.b} fill="transparent" />
              <line x1={x(i)} x2={x(i)} y1={pad.t} y2={H - pad.b} stroke="var(--color-slate-300)" strokeWidth={1} className="opacity-0 group-hover:opacity-100" />
              <circle cx={x(i)} cy={y(b.passRate)} r={4} fill="var(--color-accent-600)" stroke="var(--color-surface)" strokeWidth={2} />
              <title>{`${b.label}: ${pct(b.passRate)} passed (${summary(b.counts)})`}</title>
            </>
          )}
          {showLabel(i, n) && (
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-slate-500)">
              {b.label}
            </text>
          )}
        </g>
      ))}
      <text x={x(lastIdx)} y={y(last.passRate!) - 10} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--color-slate-900)">
        {pct(last.passRate)}
      </text>
    </svg>
  );
}

/** Hand testing and automation as two lines (ver_95), so automation never lifts the manual pass rate. */
export function SplitPassRate({ buckets }: { buckets: TrendBucket[] }) {
  const n = buckets.length;
  const x = (i: number) => pad.l + (n === 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const series = [
    { id: "manual", label: "✋ Manual", color: "var(--color-blue-600)", get: (b: TrendBucket) => b.manualRate ?? null, dash: undefined },
    { id: "auto", label: "🤖 Automated", color: "var(--color-teal-600)", get: (b: TrendBucket) => b.autoRate ?? null, dash: "6 4" },
  ];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Pass rate per period, manual and automated">
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--color-slate-200)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="var(--color-slate-500)">
              {g * 100}%
            </text>
          </g>
        ))}
        {series.map((sr) => {
          const pts = buckets.flatMap((b, i) => (sr.get(b) === null ? [] : [{ i, v: sr.get(b)!, b }]));
          return (
            <g key={sr.id} data-testid={`trend-${sr.id}`}>
              {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} fill="none" stroke={sr.color} strokeWidth={2} strokeDasharray={sr.dash} strokeLinejoin="round" />}
              {pts.map((p) => (
                <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={4} fill={sr.color} stroke="var(--color-surface)" strokeWidth={2}>
                  <title>{`${p.b.label}, ${sr.label}: ${pct(p.v)} passed`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {buckets.map((b, i) =>
          showLabel(i, n) ? (
            <text key={b.key} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-slate-500)">
              {b.label}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-slate-600">
        {series.map((sr) => (
          <span key={sr.id} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5" style={{ background: sr.color }} />
            {sr.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Bottom to top: good news first, then problems, then the rest.
const STACK: ResultStatus[] = ["PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED"];

/** Saved case results per period, stacked by status. */
export function ResultsOverTime({ buckets }: { buckets: TrendBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => totals(b.counts).total));
  const all = countStatuses(buckets.flatMap((b) => STATUSES.flatMap((s) => Array<ResultStatus>(b.counts[s]).fill(s))));
  return (
    <div>
      <div className="flex h-40 items-end gap-[2px] border-b border-slate-200" role="img" aria-label={`Results per period: ${summary(all)}`}>
        {buckets.map((b) => {
          const total = totals(b.counts).total;
          return (
            <div key={b.key} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${b.label}: ${total ? summary(b.counts) : "no results"}`}>
              <div className="flex flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] group-hover:opacity-80" style={{ height: `${(total / max) * 100}%` }}>
                {STACK.map((s) =>
                  b.counts[s] ? <div key={s} className={cx("w-full shrink-0", STATUS_STYLE[s].bar)} style={{ height: `${(b.counts[s] / total) * 100}%` }} /> : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
      <XLabels buckets={buckets} />
      <div className="mt-2">
        <StatusLegend counts={all} />
      </div>
    </div>
  );
}

/** New bugs recorded per period. One series, so no legend. */
export function BugsOverTime({ buckets }: { buckets: TrendBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.bugs));
  const total = buckets.reduce((n, b) => n + b.bugs, 0);
  if (!total) return <p className="text-sm text-slate-500">No bugs were recorded against these results.</p>;
  return (
    <div>
      <div className="flex h-28 items-end gap-[2px] border-b border-slate-200" role="img" aria-label={`${total} bugs found in this range`}>
        {buckets.map((b) => (
          <div key={b.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${b.label}: ${b.bugs} ${b.bugs === 1 ? "bug" : "bugs"} found`}>
            {b.bugs > 0 && <div className="rounded-t-[4px] bg-accent-600 hover:bg-accent-700" style={{ height: `${(b.bugs / max) * 100}%` }} />}
          </div>
        ))}
      </div>
      <XLabels buckets={buckets} />
    </div>
  );
}

function XLabels({ buckets }: { buckets: TrendBucket[] }) {
  return (
    <div className="mt-1 flex gap-[2px] text-[10px] text-slate-500">
      {buckets.map((b, i) => (
        <div key={b.key} className="min-w-0 flex-1 text-center whitespace-nowrap">
          {showLabel(i, buckets.length) ? b.label : ""}
        </div>
      ))}
    </div>
  );
}

/** Each release, oldest first: how its cases came out and the bugs found. */
export function ReleaseTrends({ releases }: { releases: ReleaseTrend[] }) {
  if (releases.length === 0) return <p className="text-sm text-slate-500">No runs in this range name a release.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr>
          <th className="pb-2 font-medium">Release</th>
          <th className="w-1/2 pb-2 font-medium">Results</th>
          <th className="pb-2 text-right font-medium">Pass rate</th>
          <th className="pb-2 text-right font-medium">Bugs</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {releases.map((r) => (
          <tr key={r.release}>
            <td className="py-2 pr-3">
              <span className="font-medium text-slate-800">{r.release}</span>
              <span className="block text-xs text-slate-500">
                {r.runs} {r.runs === 1 ? "run" : "runs"}
              </span>
            </td>
            <td className="py-2 pr-3">
              <StatusBar counts={r.counts} height="h-2.5" />
            </td>
            <td className="py-2 text-right font-semibold text-slate-800 tabular-nums">{pct(r.passRate)}</td>
            <td className="py-2 text-right text-slate-700 tabular-nums">{r.bugs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The numbers behind the period charts, for screen readers and copying. */
export function TrendTable({ buckets }: { buckets: TrendBucket[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-accent-700 hover:underline">Show as a table</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface text-left text-slate-500">
            <tr>
              <th className="py-1 font-medium">Period</th>
              {STACK.map((s) => (
                <th key={s} className="py-1 text-right font-medium">
                  {STATUS_LABEL[s]}
                </th>
              ))}
              <th className="py-1 text-right font-medium">Pass rate</th>
              <th className="py-1 text-right font-medium">Bugs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {buckets.map((b) => (
              <tr key={b.key}>
                <td className="py-1">{b.label}</td>
                {STACK.map((s) => (
                  <td key={s} className="py-1 text-right">
                    {b.counts[s] || ""}
                  </td>
                ))}
                <td className="py-1 text-right">{pct(b.passRate)}</td>
                <td className="py-1 text-right">{b.bugs || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

