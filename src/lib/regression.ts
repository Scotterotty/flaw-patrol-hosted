import type { ResultStatus } from "@prisma/client";
import { z } from "zod";

/**
 * The Regression flag (ver_93): a case gets it when it passed the last time it ran in an
 * earlier release on the same platform, and fails now. It's worked out from stored results, for
 * hand-run and automated tests alike. Flaky cases and cases that never passed don't get it,
 * and anyone can turn it off for one case in one run (RunEntry.regressionOff).
 */

export const COMPARE_MODES = [
  { id: "last-rc", label: "Last release on the same platform", tip: "The release before this one. The default. Runs with no release always compare with the last run." },
  { id: "any-rc", label: "Any earlier release on the same platform", tip: "The last release where the case actually ran, so things that broke two releases back and were never retested are caught too." },
  { id: "any-run", label: "Last run on the same platform", tip: "The last earlier run on the same platform, release or not." },
] as const;
export type CompareMode = (typeof COMPARE_MODES)[number]["id"];

export const regressionSettingsSchema = z.object({
  on: z.boolean().default(true),
  compare: z.enum(["last-rc", "any-rc", "any-run"]).default("last-rc"),
  label: z
    .string()
    .trim()
    .max(60)
    .regex(/^[^\s]*$/, "Jira labels can't have spaces")
    .default("regression"),
});
export type RegressionSettings = z.output<typeof regressionSettingsSchema>;
export const DEFAULT_REGRESSION: RegressionSettings = { on: true, compare: "last-rc", label: "regression" };

export function parseRegressionSettings(json: unknown): RegressionSettings {
  const parsed = regressionSettingsSchema.safeParse(json ?? {});
  return parsed.success ? { ...parsed.data, label: parsed.data.label || "regression" } : DEFAULT_REGRESSION;
}

/** Results that count either way: a pass or a fail. Blocked, skipped and unfinished results never do. */
export const VERDICTS: ResultStatus[] = ["PASSED", "FAILED"];
export const FAILS: ResultStatus[] = ["FAILED"];

/** An earlier result of a case, as the comparison needs it. */
export type PastResult = {
  /** The TestResult's id. */
  id: string;
  status: ResultStatus;
  at: Date;
  release: string;
  build: string;
  runNumber: number;
  runName: string;
  projectKey: string;
  platform: string;
  entryId: string;
  caseVersion: number;
  tester: string;
  stepStatuses: ResultStatus[];
};

const rcKey = (s: string) => s.trim().toLowerCase();

/**
 * The earlier result a case is compared with, from its past results on the same platform
 * (any order), or null. `release` is the RC being tested now ("" when the run has none).
 * `lastRc` is the newest earlier release anything on this platform ran in (see lastRcOf): with
 * "last-rc" a case that wasn't run in it isn't compared further back. `only` picks one
 * earlier release by hand ("Compared with Web RC 21" ▾).
 */
export function comparisonFor(past: PastResult[], release: string, mode: CompareMode, opts: { lastRc?: string | null; only?: string } = {}): PastResult | null {
  const now = rcKey(release);
  const counted = past.filter((p) => VERDICTS.includes(p.status)).sort((a, b) => b.at.getTime() - a.at.getTime());
  if (opts.only) return counted.find((p) => rcKey(p.release) === rcKey(opts.only!)) ?? null;
  // Without an RC on this run there's nothing to compare RCs with, so the last run counts.
  if (mode === "any-run" || !now) return counted[0] ?? null;
  const earlier = counted.filter((p) => p.release.trim() && rcKey(p.release) !== now);
  if (mode === "any-rc") return earlier[0] ?? null;
  const last = opts.lastRc ? rcKey(opts.lastRc) : earlier[0] ? rcKey(earlier[0].release) : null;
  return last ? (earlier.find((p) => rcKey(p.release) === last) ?? null) : null;
}

/** The newest earlier release anything on this platform ran in, before `release`. */
export function lastRcOf(past: { release: string; at: Date }[], release: string) {
  const now = rcKey(release);
  const sorted = past.filter((p) => p.release.trim() && rcKey(p.release) !== now).sort((a, b) => b.at.getTime() - a.at.getTime());
  return sorted[0]?.release.trim() ?? null;
}

/** Whether the case is flagged: it fails now, passed in the comparison, isn't flaky, and nobody turned the flag off. */
export function isRegression(now: ResultStatus, against: PastResult | null, opts: { flaky: boolean; off: boolean; on: boolean }) {
  return opts.on && !opts.off && !opts.flaky && FAILS.includes(now) && against?.status === "PASSED";
}

/** "Web RC 21", or the run's name when it had no RC. */
export function againstLabel(p: Pick<PastResult, "platform" | "release" | "runName">) {
  if (!p.release.trim()) return p.runName;
  return p.platform && !p.release.toLowerCase().includes(p.platform.toLowerCase()) ? `${p.platform} ${p.release.trim()}` : p.release.trim();
}

/** "Passed in Web RC 21 (Oct 24, Dana). Failed here." for the badge's hover. */
export function regressionTip(p: PastResult, spelling: "us" | "uk" = "us") {
  const day = p.at.toLocaleDateString(spelling === "uk" ? "en-GB" : "en-US", { month: "short", day: "numeric" });
  return `Passed in ${againstLabel(p)} (${day}${p.tester ? `, ${p.tester}` : ""}). Failed here.`;
}

/** The step that passed there and fails now, by position when the steps line up. */
export function stepPassedThere(p: PastResult | null, step: number, stepCount: number) {
  if (!p || p.stepStatuses.length !== stepCount) return false;
  return p.stepStatuses[step] === "PASSED";
}

/**
 * A case's own history with the flag kept on the result where it broke, and "Fixed again" on
 * the pass that came after (ver_93). `rows` are its results, any order, with their platform.
 */
export function historyMarks(rows: (PastResult & { off: boolean })[], mode: CompareMode, flaky: boolean): Map<string, "regression" | "fixed"> {
  const out = new Map<string, "regression" | "fixed">();
  if (flaky) return out;
  const asc = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const broken = new Set<string>();
  for (const [n, r] of asc.entries()) {
    const plat = r.platform.toLowerCase();
    const before = asc.slice(0, n).filter((p) => p.platform.toLowerCase() === plat && p.runNumber + p.projectKey !== r.runNumber + r.projectKey);
    if (FAILS.includes(r.status)) {
      const against = comparisonFor(before, r.release, mode);
      if (isRegression(r.status, against, { flaky: false, off: r.off, on: true })) {
        out.set(r.id, "regression");
        broken.add(plat);
      }
    } else if (r.status === "PASSED" && broken.has(plat)) {
      out.set(r.id, "fixed");
      broken.delete(plat);
    }
  }
  return out;
}
