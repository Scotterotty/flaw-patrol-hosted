"use client";

import { useZone } from "./spelling";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cx } from "@/components/ui";
import { buildCount, buildHealth, runBars, TREND_COUNTS, type BuildPoint, type HomeTrendsData, type RunsShown, type TrendCase, type TrendCount, type TrendPoint } from "@/lib/home-trends-calc";
import { saveHomeTrendPrefs } from "@/server/home-trends";

type Mode = "release" | "week" | "build";
type Kind = "man" | "auto";
type Platform = { name: string; color: string };

const MANUAL = "var(--color-blue-700)";
const AUTO = "var(--color-teal-700)";
const pctOf = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, w: string, many = `${w}s`) => `${fmt(n)} ${n === 1 ? w : many}`;

/**
 * How testing is going on an umbrella's home: pass rate by release or by week,
 * manual and automated apart, with the Flaky and Keeps failing lists. Hide, and how many
 * releases to show, are saved for this person only.
 */
export function HomeTrendsBox({
  data,
  platforms,
  groupId,
  initial,
  startHref,
}: {
  data: HomeTrendsData;
  platforms: Platform[];
  groupId: string;
  initial: { hidden: boolean; count: TrendCount; runs: RunsShown };
  startHref: string | null;
}) {
  const g = `/g/${groupId}`;
  const enoughReleases = data.release.length >= 2;
  const anyResults = data.week.some((p) => p.manCases + p.autoCases);
  const anyRuns = data.build.length + data.manualRuns.length > 0;
  // A run just started has no results yet: open on By run so it still shows.
  const [mode, setMode] = useState<Mode>(enoughReleases ? "release" : anyResults || !anyRuns ? "week" : "build");
  const [split, setSplit] = useState(false);
  const [kind, setKind] = useState<Kind>(data.hasManual ? "man" : "auto");
  const [list, setList] = useState<"flaky" | "failing">(data.flakyTotal || !data.failingTotal ? "flaky" : "failing");
  const [hidden, setHidden] = useState(initial.hidden);
  const [count, setCount] = useState<TrendCount>(initial.count);
  const bothRuns = data.build.length > 0 && data.manualRuns.length > 0;
  // Both, or one kind; with only one kind of run there's nothing to pick.
  const [runsShown, setRunsShown] = useState<RunsShown>(initial.runs);
  const runsKind: RunsShown = bothRuns ? runsShown : data.manualRuns.length ? "man" : "auto";
  const save = (next: { hidden: boolean; count: number; runs?: RunsShown }) => void saveHomeTrendPrefs({ runs: runsShown, ...next });

  const all = mode === "release" ? data.release : data.week;
  const shown = count ? all.slice(-count) : all;
  // By run: one bar per run, the newest of each kind.
  const builds = runBars(data, runsKind, count ? buildCount(count) : null);
  const empty = !data.release.length && !anyResults && !anyRuns;
  // The tiles read the newest release, or the newest week with results.
  const withData = all.filter((p) => p.manCases + p.autoCases > 0);
  const last = withData.at(-1);
  const prev = (k: Kind) => [...withData.slice(0, -1)].reverse().find((p) => p[k] !== null);
  const when = (p: TrendPoint | undefined) => (!p ? "" : mode === "release" ? p.label : p.key === data.thisWeek ? "this week" : p.key === weekBefore(data.thisWeek) ? "last week" : `week of ${p.label}`);
  const usedPlatforms = platforms.filter((p) => all.some((x) => x.plat[p.name]));
  const canSplit = usedPlatforms.length > 1;
  const both = data.hasManual && data.hasAuto;
  const unit = mode === "release" ? "release" : mode === "week" ? "week" : "run";
  const om = data.openManual;

  const fold = () => {
    const next = !hidden;
    setHidden(next);
    save({ hidden: next, count });
  };

  const summary = (
    <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-sm text-slate-600" data-testid="trends-summary">
      {(data.hasManual || !!om?.inProgress) && (
        <span data-testid="trends-summary-manual">
          ✋ Manual{" "}
          {data.hasManual ? <b className="text-slate-900 tabular-nums">{pctOf(last?.man ?? null)}</b> : ":"}
          {/* Open runs tested by hand: finished and started cases, never who did them. */}
          {om && om.finished > 0 && ` · ${fmt(om.finished)} of ${fmt(om.total)} finished`}
          {om && om.inProgress > 0 && <b className="text-slate-900"> · {fmt(om.inProgress)} in progress</b>}
          {!data.hasManual && " no results yet"}
        </span>
      )}
      {data.hasAuto && (
        <span>
          🤖 Automated <b className="text-slate-900 tabular-nums">{pctOf(last?.auto ?? null)}</b>
        </span>
      )}
      {data.flakyTotal > 0 && (
        <span>
          ⚡ <b className="text-slate-900 tabular-nums">{data.flakyTotal}</b> flaky
        </span>
      )}
      {last && <span>{when(last)}</span>}
    </span>
  );

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-surface" aria-labelledby="trends-title" data-testid="home-trends">
      <div className={cx("flex flex-wrap items-center justify-between gap-2.5 px-4 py-3", !hidden && "border-b border-slate-200")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1.5">
          <h2 id="trends-title" className="font-semibold text-slate-900">
            How testing is going
          </h2>
          {hidden && !empty && summary}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {!hidden && !empty && (
            <>
              <Seg
                label="Group results by"
                value={mode}
                onChange={(m) => setMode(m as Mode)}
                options={[
                  { id: "release", label: "By release", disabled: !enoughReleases, title: enoughReleases ? undefined : "Needs two releases with results" },
                  { id: "week", label: "By week" },
                  { id: "build", label: "By run", disabled: !anyRuns, title: anyRuns ? "Each manual run and each automated build" : "Needs a run" },
                ]}
              />
              {mode === "build" && bothRuns && (
                <Seg
                  label="Which runs"
                  value={runsShown}
                  onChange={(v) => {
                    setRunsShown(v as RunsShown);
                    save({ hidden, count, runs: v as RunsShown });
                  }}
                  options={[
                    { id: "both", label: "Both" },
                    { id: "man", label: "✋ Manual" },
                    { id: "auto", label: "🤖 Automated" },
                  ]}
                />
              )}
              <select
                aria-label="How many to show"
                data-testid="trends-count"
                className="rounded-md border border-slate-200 bg-surface px-2 py-1 text-sm text-slate-800"
                value={count}
                onChange={(e) => {
                  const c = Number(e.target.value) as TrendCount;
                  setCount(c);
                  save({ hidden, count: c });
                }}
              >
                {TREND_COUNTS.map((c) => (
                  <option key={c} value={c}>
                    {c ? `Last ${mode === "build" ? buildCount(c) : c} ${unit}s${mode === "build" && runsKind === "both" ? " of each" : ""}` : `All ${unit}s`}
                  </option>
                ))}
              </select>
              <Link href={`${g}/reports?view=trends&range=all`} className="text-sm text-accent-700 hover:underline">
                Open in Reports →
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={fold}
            aria-expanded={!hidden}
            aria-controls="trends-body"
            data-testid="trends-fold"
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-200 bg-accent-50 px-3 py-1 text-sm font-semibold text-accent-700 hover:border-accent-500 hover:bg-surface"
          >
            <span aria-hidden>{hidden ? "▾" : "▴"}</span> {hidden ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      {!hidden && (
        <div id="trends-body">
          {empty ? (
            <div className="p-4">
              <div className="grid gap-1.5 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                <b className="text-slate-900">No finished runs yet</b>
                <span>Trends show up here after your first run has results.</span>
                {startHref && (
                  <Link href={startHref} className="text-accent-700 hover:underline">
                    Create a run
                  </Link>
                )}
              </div>
            </div>
          ) : (
            mode === "build" ? (
              <>
                <ManualHealth points={builds.filter((p) => p.manual)} />
                <BuildHealth points={builds.filter((p) => !p.manual)} />
                <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <div className="relative min-w-0 border-b border-slate-200 p-4 lg:border-r lg:border-b-0">
                    <h3 className="text-sm font-semibold text-slate-900">Pass rate by run</h3>
                    <p className="mt-0.5 mb-2 text-xs text-slate-500" data-testid="by-run-note">
                      {runsKind === "man"
                        ? "Runs tested by hand, with how much of each is done."
                        : runsKind === "auto"
                          ? "Automated runs only: each GitHub pull or upload, with a release or not."
                          : "Every run tested by hand and every GitHub pull or upload. Manual and automated are never added together."}{" "}
                      {count && data.build.length + data.manualRuns.length > builds.length ? `Newest ${plural(builds.length, "run")}.` : `All ${plural(builds.length, "run")}.`} Bug bashes left out. Click a bar to open that run.
                    </p>
                    <BuildBars points={builds} />
                  </div>
                  <CaseLists data={data} list={list} setList={setList} g={g} />
                </div>
              </>
            ) : (
            <>
              <Tiles last={last} prev={prev} when={when(last)} prevWhen={(k) => when(prev(k))} data={data} mode={mode} />
              <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="relative min-w-0 border-b border-slate-200 p-4 lg:border-r lg:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Pass rate by {unit}</h3>
                      <p className="mt-0.5 mb-2 text-xs text-slate-500">
                        Cases that passed, out of those with a result. {count && all.length > count ? `Last ${count} ${unit}s.` : `All ${plural(all.length, unit)}.`} Bug bashes left out.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canSplit && (
                        <Seg
                          label="Lines"
                          value={split ? "split" : "all"}
                          onChange={(v) => setSplit(v === "split")}
                          options={[
                            { id: "all", label: "All together" },
                            { id: "split", label: "Each platform" },
                          ]}
                        />
                      )}
                      {split && both && (
                        <Seg
                          label="Which results"
                          value={kind}
                          onChange={(v) => setKind(v as Kind)}
                          options={[
                            { id: "man", label: "✋ Manual" },
                            { id: "auto", label: "🤖 Automated" },
                          ]}
                        />
                      )}
                    </div>
                  </div>
                  <Chart points={shown} split={split && canSplit} kind={both ? kind : data.hasManual ? "man" : "auto"} data={data} platforms={usedPlatforms} mode={mode} g={g} />
                </div>
                <CaseLists data={data} list={list} setList={setList} g={g} />
              </div>
            </>
            )
          )}
        </div>
      )}
    </section>
  );
}

/** "Nov 1, 1:05 PM PST", in the viewer's own time zone. */
const timeOf = (iso: string, zone?: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: zone });

/** By build: the newest automated run, and how the last ones went, in one line. */
function BuildHealth({ points }: { points: BuildPoint[] }) {
  const zone = useZone();
  const last = points.at(-1);
  if (!last) return null;
  const h = buildHealth(points);
  const parts = [h.all && `${fmt(h.all)} all passed`, h.failed && `${fmt(h.failed)} had failures`, h.none && `${fmt(h.none)} had no tests run`].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-slate-200 px-4 py-3 text-sm" data-testid="build-health">
      <b className="text-slate-900">Last build: {last.name || last.label}</b>
      <span className={cx("rounded px-1.5 py-px text-xs font-medium", last.failed ? "bg-st-failed-soft text-st-failed-ink" : last.rate === null ? "bg-slate-100 text-slate-600" : "bg-st-passed-soft text-st-passed-ink")}>
        {last.rate === null ? "No tests ran" : `${fmt(last.passed)} of ${fmt(last.passed + last.failed)} passed`}
      </span>
      <span className="text-slate-500" suppressHydrationWarning>
        {timeOf(last.at, zone)}
        {last.platform && ` · ${last.platform}`}
      </span>
      {points.length > 1 && (
        <span className="text-slate-500">
          · Last {plural(points.length, "build")}: {parts.join(", ")}
        </span>
      )}
    </div>
  );
}

/** By run: the newest run tested by hand, finished and started, in one line. */
function ManualHealth({ points }: { points: BuildPoint[] }) {
  const zone = useZone();
  const last = points.at(-1);
  if (!last?.manual) return null;
  const m = last.manual;
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-slate-200 px-4 py-3 text-sm" data-testid="manual-health">
      <b className="text-slate-900">
        Last manual run: ✋ {[m.release, `${last.platform ? `${last.platform} ` : ""}${last.label}`].filter(Boolean).join(" · ")}
      </b>
      <span className={cx("rounded px-1.5 py-px text-xs font-medium", last.failed ? "bg-st-failed-soft text-st-failed-ink" : last.rate === null ? "bg-slate-100 text-slate-600" : "bg-st-passed-soft text-st-passed-ink")}>
        {last.rate === null ? "No results yet" : `${fmt(last.passed)} of ${fmt(last.passed + last.failed)} finished passed`}
      </span>
      <span className="text-slate-500">
        {fmt(m.finished)} of {fmt(m.total)} done{m.inProgress ? ` · ${fmt(m.inProgress)} in progress` : ""}
      </span>
      <span className="text-slate-500" suppressHydrationWarning>
        {timeOf(last.at, zone)}
      </span>
    </div>
  );
}

const donePct = (m: NonNullable<BuildPoint["manual"]>) => (m.total ? Math.round((m.finished / m.total) * 100) : 0);

/** One bar per run, newest on the right; a failed test turns its bar red. Hand runs are striped and say how much is done. */
function BuildBars({ points }: { points: BuildPoint[] }) {
  const every = Math.ceil(points.length / 12);
  const hasManual = points.some((p) => p.manual);
  return (
    <div>
      <div className="flex h-36 items-end gap-1 border-b border-slate-200" role="list" aria-label="Pass rate per build" data-testid="build-bars">
        {points.map((p) => {
          const m = p.manual;
          const tip = m
            ? `${[m.release, p.platform, p.label].filter(Boolean).join(" · ")} (${p.name}): ${p.passed} passed, ${p.failed} failed, ${m.inProgress} in progress, ${m.total - m.finished - m.inProgress} not started`
            : `${p.name || p.label}: ${p.rate === null ? "no tests ran" : `${p.passed} of ${p.passed + p.failed} passed`}`;
          return (
            <Link
              key={p.runId}
              href={p.href}
              role="listitem"
              aria-label={tip}
              title={`${tip} · open the run`}
              data-testid={m ? "manual-bar" : "build-bar"}
              className="group flex h-full max-w-12 min-w-0 flex-1 items-end"
            >
              {m && p.rate === null ? (
                // Started, nothing finished: an empty outline so the run still shows.
                <span className="block h-full w-full rounded-t-sm border border-dashed border-blue-400 group-hover:opacity-80" />
              ) : (
                <span
                  className={cx("block w-full rounded-t-sm group-hover:opacity-80", p.rate === null ? "h-full" : p.failed ? "bg-st-failed" : "bg-st-passed")}
                  style={p.rate === null ? { background: HATCH } : { height: `${Math.max(4, Math.round(p.rate * 100))}%`, ...(m ? { backgroundImage: STRIPES } : {}) }}
                />
              )}
            </Link>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10.5px] text-slate-500 tabular-nums">
        {points.map((p, i) => (
          <span key={p.runId} className={cx("max-w-12 min-w-0 flex-1 truncate text-center", i === points.length - 1 && "font-semibold text-slate-900")}>
            {(points.length - 1 - i) % every === 0 ? p.label : ""}
          </span>
        ))}
      </div>
      {/* Under a hand run that isn't finished: how much of it is done. */}
      {points.some((p) => p.manual && donePct(p.manual) < 100) && (
        <div className="flex gap-1 text-[10px] font-medium text-blue-700 tabular-nums" data-testid="done-row">
          {points.map((p) => (
            <span key={p.runId} className="max-w-12 min-w-0 flex-1 truncate text-center">
              {p.manual && donePct(p.manual) < 100 ? `${donePct(p.manual)}%` : ""}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-2.5 rounded-xs bg-st-passed" /> All passed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-2.5 rounded-xs bg-st-failed" /> Some failed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-2.5 rounded-xs" style={{ background: HATCH }} /> No tests ran
        </span>
        {hasManual && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block size-2.5 rounded-xs bg-slate-400" style={{ backgroundImage: STRIPES }} /> Striped = tested by hand
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block size-2.5 rounded-xs border border-dashed border-blue-400" /> Started, nothing finished
            </span>
            {points.some((p) => p.manual && donePct(p.manual) < 100) && <span className="text-blue-700">Blue % under a bar = how much of that hand run is done</span>}
          </>
        )}
        <span>Times in your time zone</span>
      </div>
    </div>
  );
}

const STRIPES = "repeating-linear-gradient(135deg, transparent 0 4px, rgb(255 255 255 / 0.35) 4px 7px)";
const HATCH = "repeating-linear-gradient(45deg, var(--color-slate-300) 0 3px, transparent 3px 6px)";

function weekBefore(key: string) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function Seg({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; label: string; disabled?: boolean; title?: string }[] }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-full border border-slate-200 p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cx(
            "rounded-full px-2.5 py-0.5 disabled:cursor-not-allowed disabled:opacity-50",
            value === o.id ? "bg-accent-50 font-semibold text-accent-700 ring-1 ring-accent-200" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Delta({ now, before, since }: { now: number | null; before: number | null | undefined; since: string }) {
  if (now === null || before === null || before === undefined) return <span className="text-xs text-slate-500">{since ? `nothing to compare with ${since}` : "first one with results"}</span>;
  const d = Math.round(now * 100) - Math.round(before * 100);
  return (
    <span className="text-xs text-slate-600">
      {d === 0 ? <span>no change</span> : <span className={cx("font-semibold", d > 0 ? "text-st-passed-ink" : "text-st-failed-ink")}>{d > 0 ? "▲" : "▼"} {plural(Math.abs(d), "point")}</span>} since {since}
    </span>
  );
}

function Tiles({ last, prev, when, prevWhen, data, mode }: { last: TrendPoint | undefined; prev: (k: Kind) => TrendPoint | undefined; when: string; prevWhen: (k: Kind) => string; data: HomeTrendsData; mode: Mode }) {
  const tiles: { k: string; v: React.ReactNode; s: React.ReactNode; id: string }[] = [];
  const kinds: [Kind, string, boolean][] = [
    ["man", "✋ Manual", data.hasManual],
    ["auto", "🤖 Automated", data.hasAuto],
  ];
  for (const [k, label, on] of kinds)
    if (on) tiles.push({ id: k, k: `${label} pass rate, ${when}`, v: pctOf(last?.[k] ?? null), s: <Delta now={last?.[k] ?? null} before={prev(k)?.[k]} since={prevWhen(k)} /> });
  const both = data.hasManual && data.hasAuto;
  const runs = plural(last?.runs ?? 0, "run");
  tiles.push({
    id: "cases",
    k: `Cases tested, ${when}`,
    v: both ? (
      <span className="flex flex-wrap items-baseline gap-1.5">
        {fmt(last?.manCases ?? 0)} <small className="text-xs text-slate-500">✋</small> · {fmt(last?.autoCases ?? 0)} <small className="text-xs text-slate-500">🤖</small>
      </span>
    ) : (
      fmt((last?.manCases ?? 0) + (last?.autoCases ?? 0))
    ),
    s:
      mode === "release" && last?.planned
        ? `${both ? "✋ " : ""}of ${fmt(last.planned)} planned · ${runs}`
        : `${last?.people ? `by ${plural(last.people, "person", "people")} · ` : ""}${runs}`,
  });
  tiles.push({ id: "bugs", k: `Bugs found, ${when}`, v: fmt(last?.bugs ?? 0), s: last?.bugs ? `${fmt(last.severe)} critical · ${fmt(last.openBugs)} still open` : "None linked to results" });
  return (
    <div className={cx("grid border-b border-slate-200 sm:grid-cols-2", tiles.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")} data-testid="trends-tiles">
      {tiles.map((t) => (
        <div key={t.id} className="grid min-w-0 gap-0.5 border-slate-200 px-4 py-3.5 not-first:border-t sm:not-first:border-t-0 sm:[&:nth-child(n+3)]:border-t lg:[&:nth-child(n+3)]:border-t-0 lg:not-first:border-l sm:even:border-l" data-testid={`trends-tile-${t.id}`}>
          <span className="text-xs text-slate-500">{t.k}</span>
          <span className="text-2xl leading-tight font-semibold text-slate-900 tabular-nums">{t.v}</span>
          <span className="text-xs text-slate-600">{t.s}</span>
        </div>
      ))}
    </div>
  );
}

const W = 560;
const H = 230;
const PAD = { l: 40, r: 78, t: 12, b: 30 };

type Line = { id: string; label: string; color: string; dashed: boolean; shape: "circle" | "square" | "diamond"; values: (number | null)[] };

function Chart({ points, split, kind, data, platforms, mode, g }: { points: TrendPoint[]; split: boolean; kind: Kind; data: HomeTrendsData; platforms: Platform[]; mode: Mode; g: string }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shapes = ["circle", "square", "diamond"] as const;
  const lines: Line[] = split
    ? platforms.map((p, i) => ({ id: p.name, label: p.name, color: p.color, dashed: kind === "auto", shape: shapes[i % 3], values: points.map((x) => x.plat[p.name]?.[kind] ?? null) }))
    : [
        ...(data.hasManual ? [{ id: "man", label: "Manual", color: MANUAL, dashed: false, shape: "circle" as const, values: points.map((x) => x.man) }] : []),
        ...(data.hasAuto ? [{ id: "auto", label: "Automated", color: AUTO, dashed: true, shape: "square" as const, values: points.map((x) => x.auto) }] : []),
      ];
  const n = points.length;
  const vals = lines.flatMap((l) => l.values).filter((v): v is number => v !== null);
  if (!vals.length) return <p className="py-6 text-sm text-slate-500">No pass or fail results in these {mode === "release" ? "releases" : "weeks"} yet.</p>;
  // The scale starts 10 points under the lowest rate, so small changes still show.
  const y0 = Math.max(0, Math.floor((Math.min(...vals) * 100 - 5) / 10) * 10);
  const x = (i: number) => (n === 1 ? (PAD.l + W - PAD.r) / 2 : PAD.l + (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v: number) => PAD.t + ((100 - v * 100) / (100 - y0 || 1)) * (H - PAD.t - PAD.b);
  const every = Math.ceil(n / 6);
  const marks = n <= 8;
  const step = n > 1 ? (W - PAD.l - PAD.r) / (n - 1) : W - PAD.l - PAD.r;
  const path = (vs: (number | null)[]) => {
    let d = "";
    let pen = false;
    vs.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const dot = (l: Line, i: number, v: number) => {
    const cx = x(i);
    const cy = y(v);
    const ring = { stroke: "var(--color-surface)", strokeWidth: 2 };
    if (l.shape === "square") return <rect key={`${l.id}${i}`} x={cx - 4} y={cy - 4} width={8} height={8} rx={1.5} fill={l.color} {...ring} />;
    if (l.shape === "diamond") return <path key={`${l.id}${i}`} d={`M${cx} ${cy - 5.5}L${cx + 5.5} ${cy}L${cx} ${cy + 5.5}L${cx - 5.5} ${cy}Z`} fill={l.color} {...ring} />;
    return <circle key={`${l.id}${i}`} cx={cx} cy={cy} r={4.5} fill={l.color} {...ring} />;
  };
  // Labels at the right end, nudged apart so they never sit on top of each other.
  const ends = lines
    .map((l) => {
      const i = l.values.findLastIndex((v) => v !== null);
      return i < 0 ? null : { l, i, v: l.values[i]!, yy: y(l.values[i]!) };
    })
    .filter((e) => e !== null)
    .sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
  const href = (p: TrendPoint) => (mode === "release" ? `${g}/reports?view=trends&release=${encodeURIComponent(p.key)}` : `${g}/reports?view=trends&from=${p.key}&to=${weekEnd(p.key)}`);
  const ticks: number[] = [];
  for (let v = y0; v <= 100; v += y0 >= 60 ? 10 : 20) ticks.push(v);

  const tip = hover === null ? null : points[hover];
  let tipLeft = 0;
  if (hover !== null && svg.current && box.current) {
    const sr = svg.current.getBoundingClientRect();
    const br = box.current.getBoundingClientRect();
    const scale = sr.width / W;
    const left = sr.left - br.left + x(hover) * scale;
    tipLeft = Math.max(4, Math.min(br.width - 200, x(hover) > W / 2 ? left - 196 : left + 12));
  }

  return (
    <div ref={box} className="relative">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`Pass rate by ${mode}, ${lines.map((l) => l.label).join(" and ")}`} data-testid="trends-chart">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r + 8} y1={y(v / 100)} y2={y(v / 100)} stroke="var(--color-slate-200)" strokeDasharray={v === y0 ? undefined : "2 4"} />
            <text x={PAD.l - 8} y={y(v / 100) + 4} textAnchor="end" fontSize={11} fill="var(--color-slate-500)">
              {v}%
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          (n - 1 - i) % every === 0 ? (
            <text key={p.key} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={i === n - 1 ? "var(--color-slate-900)" : "var(--color-slate-500)"} fontWeight={i === n - 1 ? 600 : undefined}>
              {p.label.length > 14 ? `${p.label.slice(0, 13)}…` : p.label}
            </text>
          ) : null,
        )}
        {lines.map((l) => (
          <path key={l.id} d={path(l.values)} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={l.dashed ? "6 4" : undefined} />
        ))}
        {lines.map((l) =>
          l.values.map((v, i) => {
            if (v === null) return null;
            // Many points: only the newest gets a mark, and lone points between gaps, so they still show.
            const lone = (i === 0 || l.values[i - 1] === null) && (i === n - 1 || l.values[i + 1] === null);
            return marks || i === l.values.findLastIndex((x) => x !== null) || lone || hover === i ? dot(l, i, v) : null;
          }),
        )}
        {ends.map((e) => (
          <text key={e.l.id} x={x(n - 1) + 10} y={e.yy + 4} fontSize={11.5} fill="var(--color-slate-600)">
            <tspan fontWeight={600} fill="var(--color-slate-900)">
              {pctOf(e.v)}
            </tspan>{" "}
            {e.l.label}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-slate-400)" strokeDasharray="3 3" />}
        {points.map((p, i) => (
          <rect
            key={p.key}
            data-testid="trends-point"
            x={x(i) - step / 2}
            y={PAD.t}
            width={step}
            height={H - PAD.t - PAD.b}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => router.push(href(p))}
          >
            <title>{`${p.label}: open in Reports`}</title>
          </rect>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-slate-600">
        {lines.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" x2="18" y1="3" y2="3" stroke={l.color} strokeWidth={2.5} strokeDasharray={l.dashed ? "5 3" : undefined} />
            </svg>
            {split ? l.label : l.id === "man" ? "✋ Manual" : "🤖 Automated"}
          </span>
        ))}
        {split && data.hasManual && data.hasAuto && <span>{kind === "man" ? "✋ Manual results only" : "🤖 Automated results only"}</span>}
      </div>
      {tip && (
        <div className="pointer-events-none absolute top-4 z-10 grid min-w-44 gap-0.5 rounded-lg bg-slate-900 px-2.5 py-2 text-xs text-slate-50 shadow-lg" style={{ left: tipLeft }} data-testid="trends-tip">
          <b className="text-[13px]">{mode === "release" ? tip.label : `Week of ${tip.label}`}</b>
          {lines.map((l) => (
            <span key={l.id}>
              {split ? l.label : l.id === "man" ? "✋ Manual" : "🤖 Automated"}: <b>{pctOf(l.values[hover!])}</b>
            </span>
          ))}
          <span>
            {plural(tip.runs, "run")} · {plural(tip.bugs, "bug")} found
          </span>
          <span className="opacity-70">Click to open in Reports</span>
        </div>
      )}
    </div>
  );
}

function weekEnd(key: string) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function CaseLists({ data, list, setList, g }: { data: HomeTrendsData; list: "flaky" | "failing"; setList: (l: "flaky" | "failing") => void; g: string }) {
  const rows = list === "flaky" ? data.flaky : data.failing;
  const total = list === "flaky" ? data.flakyTotal : data.failingTotal;
  const both = data.hasManual && data.hasAuto;
  const tab = (id: "flaky" | "failing", label: string, n: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={list === id}
      onClick={() => setList(id)}
      className={cx("-mb-px border-b-2 px-2 py-1.5 text-sm", list === id ? "border-accent-600 font-semibold text-accent-700" : "border-transparent text-slate-600 hover:text-slate-900")}
    >
      {label} <span className="font-normal text-slate-500">{n}</span>
    </button>
  );
  return (
    <div className="grid min-w-0 content-start gap-2.5 p-4">
      <div role="tablist" aria-label="Cases to look at" className="flex gap-1 border-b border-slate-200">
        {tab("flaky", "⚡ Flaky", data.flakyTotal)}
        {tab("failing", "Keeps failing", data.failingTotal)}
      </div>
      <p className="text-xs text-slate-500">
        {list === "flaky"
          ? "Passed, then failed, then passed again in their last 10 runs. Often a timing or setup problem, not a real bug."
          : "Failed their last 3 runs or more in a row. Check whether a bug is already filed."}
      </p>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-slate-500" data-testid="trends-list-empty">
          {list === "flaky" ? "No flaky cases right now." : "Nothing keeps failing right now."}
        </p>
      ) : (
        <ul className="grid" data-testid={`trends-list-${list}`}>
          {rows.map((r) => (
            <CaseRow key={r.caseKey} r={r} list={list} showKind={both} />
          ))}
        </ul>
      )}
      {total > rows.length && (
        <Link href={`${g}/reports?view=cases&range=all`} className="text-sm text-accent-700 hover:underline">
          See all {total} in Reports →
        </Link>
      )}
    </div>
  );
}

function CaseRow({ r, list, showKind }: { r: TrendCase; list: "flaky" | "failing"; showKind: boolean }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 border-b border-slate-100 py-2 last:border-b-0">
      <span className="min-w-0 truncate text-sm">
        <code className="mr-1.5 font-mono text-[11.5px] text-accent-700">{r.caseKey}</code>
        <Link href={r.href} className="text-slate-800 hover:underline">
          {r.title}
        </Link>
      </span>
      <span className={cx("self-center rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap", list === "flaky" ? "bg-amber-100 text-amber-800" : "bg-st-failed-soft text-st-failed-ink")}>
        {list === "flaky" ? `⚡ ${r.count} flips` : `Failed ${r.count} in a row`}
      </span>
      <span className="col-span-2 flex items-center gap-0.75" aria-label={`Last ${r.dots.length} results, newest first`}>
        {r.dots.map((d, i) => (
          <i key={i} className="inline-block size-2.25 rounded-xs" style={{ background: d === "p" ? "var(--st-passed)" : d === "f" ? "var(--st-failed)" : "var(--color-slate-300)" }} />
        ))}
        <small className="ml-1.5 text-[11px] text-slate-500">newest first{r.platform ? ` · ${r.platform}` : ""}</small>
        {showKind && <span className="ml-auto rounded-full bg-slate-100 px-2 py-px text-[11px] font-semibold whitespace-nowrap text-slate-600">{r.automated ? "🤖 Automated" : "✋ Manual"}</span>}
      </span>
    </li>
  );
}
