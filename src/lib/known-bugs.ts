import "server-only";
import { db } from "./db";
import { mapHistorySteps } from "./run-history";
import type { ExpandedStep } from "./steps";

// Known bugs (ver_96): bugs linked to the same case in an earlier run that aren't closed, so
// people in this run know what to expect and nobody files the same bug twice.

export type KnownState = "open" | "fixed" | "expected";
export type KnownBug = {
  id: string;
  number: number;
  key: string;
  externalKey: string | null;
  url: string | null;
  title: string;
  status: string;
  state: KnownState;
  /** The step in this run's case it was found at, or null for the whole case. */
  stepIndex: number | null;
  found: { run: number; by: string; at: string; step: string | null };
  /** This run's check on it, for this case. */
  check: { outcome: "still" | "gone"; by: string; at: string } | null;
};

const ORDER: Record<KnownState, number> = { open: 0, fixed: 1, expected: 2 };

export function knownState(d: { status: string; externalStatus: string | null; externalCategory: string | null }): KnownState {
  if (d.status === "WONT_FIX" || /won.?t (fix|do)/i.test(d.externalStatus ?? "")) return "expected";
  if (d.status === "FIXED" || d.externalCategory === "done") return "fixed";
  return "open";
}

/**
 * Known bugs for each of a run's entries, by entry id. A bug drops off once it's closed in
 * Flaw Patrol, or Jira says done and an earlier run found it didn't happen.
 */
export async function knownBugsForRun(runId: string, entries: { id: string; caseId: string; steps: unknown }[]) {
  const out = new Map<string, KnownBug[]>();
  if (!entries.length) return out;
  const caseIds = [...new Set(entries.map((e) => e.caseId))];
  const [links, checks] = await Promise.all([
    db.defectLink.findMany({
      where: { result: { caseId: { in: caseIds }, runId: { not: runId } }, defect: { status: { not: "CLOSED" } } },
      select: {
        stepIndex: true,
        defect: { select: { id: true, number: true, title: true, status: true, externalKey: true, externalUrl: true, externalStatus: true, externalCategory: true, project: { select: { key: true } } } },
        result: { select: { caseId: true, createdAt: true, testerName: true, run: { select: { number: true } }, entry: { select: { steps: true } } } },
      },
      orderBy: { result: { createdAt: "desc" } },
    }),
    db.defectCheck.findMany({ where: { OR: [{ runId }, { outcome: "gone" }] }, select: { defectId: true, runId: true, entryId: true, outcome: true, byName: true, createdAt: true } }),
  ]);
  const goneElsewhere = new Set(checks.filter((c) => c.outcome === "gone" && c.runId !== runId).map((c) => c.defectId));
  for (const e of entries) {
    const steps = (Array.isArray(e.steps) ? e.steps : []) as unknown as ExpandedStep[];
    const seen = new Set<string>();
    const list: KnownBug[] = [];
    for (const l of links) {
      if (l.result.caseId !== e.caseId || seen.has(l.defect.id)) continue;
      seen.add(l.defect.id);
      const state = knownState(l.defect);
      if (state === "fixed" && goneElsewhere.has(l.defect.id)) continue;
      const old = (Array.isArray(l.result.entry.steps) ? l.result.entry.steps : []) as unknown as ExpandedStep[];
      const at = l.stepIndex === null ? -1 : (mapHistorySteps(old, steps)[l.stepIndex] ?? -1);
      const check = checks.find((c) => c.runId === runId && c.entryId === e.id && c.defectId === l.defect.id);
      list.push({
        id: l.defect.id,
        number: l.defect.number,
        key: l.defect.externalKey ?? `${l.defect.project.key}-D${l.defect.number}`,
        externalKey: l.defect.externalKey,
        url: l.defect.externalUrl,
        title: l.defect.title,
        status: l.defect.externalStatus ?? (l.defect.status === "OPEN" ? "Open" : l.defect.status === "FIXED" ? "Fixed" : "Won't fix"),
        state,
        stepIndex: at >= 0 && at < steps.length ? at : null,
        found: { run: l.result.run.number, by: l.result.testerName, at: l.result.createdAt.toISOString(), step: l.stepIndex === null ? null : (old[l.stepIndex]?.number ?? String(l.stepIndex + 1)) },
        check: check ? { outcome: check.outcome === "gone" ? "gone" : "still", by: check.byName, at: check.createdAt.toISOString() } : null,
      });
    }
    if (list.length) out.set(e.id, list.sort((a, b) => ORDER[a.state] - ORDER[b.state]));
  }
  return out;
}

/** How many known bugs touch each open run, for the Test runs list. */
export async function knownBugCounts(runIds: string[]) {
  if (!runIds.length) return new Map<string, number>();
  const entries = await db.runEntry.findMany({ where: { runId: { in: runIds } }, select: { id: true, runId: true, caseId: true } });
  const caseIds = [...new Set(entries.map((e) => e.caseId))];
  const links = caseIds.length
    ? await db.defectLink.findMany({ where: { result: { caseId: { in: caseIds } }, defect: { status: { notIn: ["CLOSED", "WONT_FIX"] } } }, select: { defectId: true, result: { select: { caseId: true, runId: true } } } })
    : [];
  const out = new Map<string, number>();
  for (const id of runIds) {
    const cases = new Set(entries.filter((e) => e.runId === id).map((e) => e.caseId));
    const bugs = new Set(links.filter((l) => l.result.runId !== id && cases.has(l.result.caseId)).map((l) => l.defectId));
    if (bugs.size) out.set(id, bugs.size);
  }
  return out;
}
