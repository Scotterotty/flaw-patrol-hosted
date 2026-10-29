import type { ResultStatus } from "@prisma/client";
import { verdictFlips } from "./run-history";

// The Repositories page's test health (ver_85), from the runs pulled from one
// GitHub repo into Flaw Patrol. Pure, so it can be unit tested.

export type PulledRun = { entries: { caseId: string; status: ResultStatus | string }[] };

/** Runs newest first; only the last 10 count. */
export function repoHealth(newestFirst: PulledRun[]) {
  const runs = newestFirst.slice(0, 10);
  const verdict = (s: string) => s === "PASSED" || s === "FAILED";
  let passed = 0;
  let total = 0;
  for (const r of runs)
    for (const e of r.entries) {
      if (!verdict(e.status)) continue;
      total++;
      if (e.status === "PASSED") passed++;
    }
  // Pass rate per run, oldest first, for the trend line.
  const trend = runs
    .map((r) => {
      const v = r.entries.filter((e) => verdict(e.status));
      return v.length ? Math.round((v.filter((e) => e.status === "PASSED").length / v.length) * 100) : null;
    })
    .filter((x): x is number => x !== null)
    .reverse();
  // Each case's verdicts across the runs, newest first.
  const history = new Map<string, ResultStatus[]>();
  for (const r of runs)
    for (const e of r.entries) {
      const h = history.get(e.caseId) ?? [];
      h.push(e.status as ResultStatus);
      history.set(e.caseId, h);
    }
  const failingNow = (runs[0]?.entries ?? [])
    .filter((e) => e.status === "FAILED")
    .map((e) => {
      const h = (history.get(e.caseId) ?? []).filter(verdict);
      let streak = 0;
      while (streak < h.length && h[streak] === "FAILED") streak++;
      return { caseId: e.caseId, streak };
    });
  const flaky = [...history.entries()].filter(([, h]) => verdictFlips(h) >= 2).map(([id]) => id);
  return {
    pulled: runs.length,
    passed,
    total,
    passRate: total ? Math.round((passed / total) * 100) : null,
    trend,
    failingNow,
    /** Failing in every pulled run it was in. */
    alwaysFailing: failingNow.length > 0 && failingNow.every((f) => f.streak === (history.get(f.caseId) ?? []).filter(verdict).length),
    flaky,
  };
}
