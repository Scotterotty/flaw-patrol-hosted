import { pct } from "@/lib/status";

type Point = { label: string; detail: string; value: number | null; automated?: boolean };

/**
 * Pass rate per run, oldest to newest. Runs tested by hand and automated runs
 * (uploaded or pulled from GitHub) get their own line, so a unit test pass rate
 * never reads as a manual one; hover a point for details.
 */
export function PassRateTrend({ points }: { points: Point[] }) {
  const data = points.filter((p): p is Point & { value: number } => p.value !== null);
  if (data.length < 2) return <p className="text-sm text-slate-500">Needs at least two runs with results to show a trend.</p>;
  const hasAuto = data.some((d) => d.automated);
  const hasManual = data.some((d) => !d.automated);
  const W = 640;
  const H = hasAuto ? 196 : 180;
  const pad = { l: 36, r: 12, t: 10, b: hasAuto ? 40 : 24 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (data.length - 1);
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const indexed = data.map((d, i) => ({ ...d, i }));
  const series = [
    { auto: false, pts: indexed.filter((d) => !d.automated) },
    { auto: true, pts: indexed.filter((d) => d.automated) },
  ].filter((s) => s.pts.length);
  const path = (pts: typeof indexed) => pts.map((d, k) => `${k ? "L" : "M"}${x(d.i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  // The accent color when every run was tested by hand; blue and teal once automated runs show.
  const tone = (auto: boolean) => (!hasAuto ? "accent" : auto ? "auto" : "manual");
  const stroke = { accent: "stroke-accent-600", manual: "stroke-blue-700", auto: "stroke-teal-700" };
  const fill = { accent: "fill-accent-600", manual: "fill-blue-700", auto: "fill-teal-700" };
  const labelEvery = Math.ceil(data.length / 8);
  return (
    <figure>
      {hasAuto && (
        <figcaption className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {hasManual && (
            <span className="inline-flex items-center gap-1.5">
              <svg width="26" height="10" aria-hidden="true">
                <line x1="0" x2="26" y1="5" y2="5" className="stroke-blue-700" strokeWidth={2} />
                <circle cx="13" cy="5" r="4" className="fill-blue-700" />
              </svg>
              Manual (tested by hand)
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <svg width="26" height="10" aria-hidden="true">
              <line x1="0" x2="26" y1="5" y2="5" className="stroke-teal-700" strokeWidth={2} strokeDasharray="6 4" />
              <rect x="9" y="1" width="8" height="8" rx="1.5" className="fill-teal-700" />
            </svg>
            🤖 Automated (uploaded or pulled from GitHub)
          </span>
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={hasAuto ? "Pass rate by run, manual and automated" : "Pass rate by run"}>
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--color-slate-200)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize={10} fill="var(--color-slate-500)">
              {g * 100}%
            </text>
          </g>
        ))}
        {series.map((s) =>
          s.pts.length > 1 ? (
            <path key={String(s.auto)} d={path(s.pts)} fill="none" className={stroke[tone(s.auto)]} strokeWidth={2} strokeLinejoin="round" strokeDasharray={hasAuto && s.auto ? "6 4" : undefined} />
          ) : null,
        )}
        {indexed.map((d) => {
          const t = tone(!!d.automated);
          const square = hasAuto && !!d.automated;
          return (
            <g key={d.i} className="group">
              <circle cx={x(d.i)} cy={y(d.value)} r={14} fill="transparent" />
              {square ? (
                <rect x={x(d.i) - 4.5} y={y(d.value) - 4.5} width={9} height={9} rx={1.5} className={fill[t]} stroke="var(--color-surface)" strokeWidth={2} />
              ) : (
                <circle cx={x(d.i)} cy={y(d.value)} r={4} className={`${fill[t]} group-hover:r-[6px]`} stroke="var(--color-surface)" strokeWidth={2} />
              )}
              <title>{`${d.label}: ${pct(d.value)} passed. ${d.detail}`}</title>
              {d.i % labelEvery === 0 || d.i === data.length - 1 ? (
                <>
                  <text x={x(d.i)} y={H - pad.b + 14} textAnchor="middle" fontSize={10} fill="var(--color-slate-500)">
                    {d.label}
                  </text>
                  {square && (
                    <text x={x(d.i)} y={H - pad.b + 29} textAnchor="middle" fontSize={10}>
                      🤖
                    </text>
                  )}
                </>
              ) : null}
            </g>
          );
        })}
        {series.map((s) => {
          const last = s.pts[s.pts.length - 1];
          // Clear of the axis labels on the left, and under the point when it's near the top.
          const anchor = last.i === data.length - 1 ? "end" : last.i === 0 ? "start" : "middle";
          const ly = last.value > 0.9 ? y(last.value) + 18 : y(last.value) - 10;
          return (
            <text key={String(s.auto)} x={x(last.i) + (anchor === "start" ? 6 : 0)} y={ly} textAnchor={anchor} fontSize={11} fontWeight={600} fill="var(--color-slate-900)">
              {pct(last.value)}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}
