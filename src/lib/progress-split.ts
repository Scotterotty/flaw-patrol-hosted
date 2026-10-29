import type { ResultStatus } from "@prisma/client";
import { countStatuses, STATUSES, totals, type StatusCounts } from "./status";

// Manual vs automated progress (ver_95). Reports never add the two together: hand
// testing counts every case in every manual run, while automation counts each
// automated case once, by its latest result, so repeat runs don't inflate it.

export type SplitRun = {
  source: "manual" | "upload" | "github";
  counts: StatusCounts;
  steps: StatusCounts;
  defects: number;
  /** Each case's status in the run. */
  caseStatuses: [string, ResultStatus][];
};

const add = (list: StatusCounts[]) => {
  const out = countStatuses([]);
  for (const c of list) for (const s of STATUSES) out[s] += c[s];
  return out;
};

export type Side = { runs: number; counts: StatusCounts; steps: StatusCounts; bugs: number };
export type AutoSide = Side & { cases: number; latest: StatusCounts };

/** `runs` newest first, as the reports list them. */
export function splitProgress(runs: SplitRun[]): { manual: Side; auto: AutoSide } {
  const manual = runs.filter((r) => r.source === "manual");
  const auto = runs.filter((r) => r.source !== "manual");
  const latest = new Map<string, ResultStatus>();
  for (const r of auto) for (const [caseId, status] of r.caseStatuses) if (!latest.has(caseId)) latest.set(caseId, status);
  return {
    manual: { runs: manual.length, counts: add(manual.map((r) => r.counts)), steps: add(manual.map((r) => r.steps)), bugs: manual.reduce((n, r) => n + r.defects, 0) },
    auto: {
      runs: auto.length,
      counts: add(auto.map((r) => r.counts)),
      steps: add(auto.map((r) => r.steps)),
      bugs: auto.reduce((n, r) => n + r.defects, 0),
      cases: latest.size,
      latest: countStatuses([...latest.values()]),
    },
  };
}

/** "0 of 39 tested by hand · 0% done". */
export function manualLine(s: Side) {
  const t = totals(s.counts);
  return { tested: t.tested, total: t.total, done: t.total ? Math.round((t.tested / t.total) * 100) : 0 };
}
