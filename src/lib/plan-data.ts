import "server-only";
import type { ResultStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { parsePlanConfigs, parsePlanValues, planCounts, type PlanValue } from "@/lib/configurations";

// What the test plan page, the runs list and the runner need to know about plans.

export type PlanRunRow = {
  id: string;
  number: number;
  state: "ACTIVE" | "COMPLETED";
  values: PlanValue[];
  statuses: ResultStatus[];
  bugs: { label: string; href: string | null }[];
  /** Who has its cases: one name, "Several people", or "" for nobody. */
  testerId: string | null;
  mixed: boolean;
};

/** A plan and its runs, with every case's status (for the Grid) and the bugs filed from each run. */
export async function planPage(projectId: string, number: number) {
  const plan = await db.testPlan.findUnique({
    where: { projectId_number: { projectId, number } },
    include: {
      runs: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          state: true,
          planValues: true,
          entries: { orderBy: { position: "asc" }, select: { id: true, caseId: true, title: true, status: true, assigneeId: true, position: true, testCase: { select: { number: true, project: { select: { key: true } } } } } },
        },
      },
    },
  });
  if (!plan) return null;
  const links = plan.runs.length
    ? await db.defectLink.findMany({
        where: { result: { runId: { in: plan.runs.map((r) => r.id) } } },
        select: { result: { select: { runId: true, caseId: true } }, defect: { select: { id: true, number: true, externalKey: true, externalUrl: true } } },
      })
    : [];
  const bugsOf = (runId: string, caseId?: string) => {
    const seen = new Set<string>();
    return links
      .filter((l) => l.result.runId === runId && (!caseId || l.result.caseId === caseId))
      .flatMap((l) => (seen.has(l.defect.id) ? [] : (seen.add(l.defect.id), [{ label: l.defect.externalKey ?? `D-${l.defect.number}`, href: l.defect.externalUrl }])));
  };
  const runs: PlanRunRow[] = plan.runs.map((r) => {
    const people = [...new Set(r.entries.map((e) => e.assigneeId))];
    return {
      id: r.id,
      number: r.number,
      state: r.state,
      values: parsePlanValues(r.planValues),
      statuses: r.entries.map((e) => e.status),
      bugs: bugsOf(r.id),
      testerId: people.length === 1 ? people[0] : null,
      mixed: people.length > 1,
    };
  });
  // Grid rows: every case in any of its runs, in the first run's order.
  const cases = new Map<string, { caseId: string; key: string; title: string }>();
  for (const r of plan.runs) for (const e of r.entries) if (!cases.has(e.caseId)) cases.set(e.caseId, { caseId: e.caseId, key: `${e.testCase.project.key}-${e.testCase.number}`, title: e.title });
  const cells = new Map<string, { entryId: string; status: ResultStatus; bugs: string[] }>();
  for (const r of plan.runs) for (const e of r.entries) cells.set(`${r.id}:${e.caseId}`, { entryId: e.id, status: e.status, bugs: bugsOf(r.id, e.caseId).map((b) => b.label) });
  const all = planCounts(runs.flatMap((r) => r.statuses));
  return { plan: { ...plan, configs: parsePlanConfigs(plan.configs) }, runs, cases: [...cases.values()], cells, counts: all };
}
export type PlanPage = NonNullable<Awaited<ReturnType<typeof planPage>>>;

/** For a plan run's blue line: its plan, values and the runs before and after it. */
export async function planLineFor(run: { planId: string | null; number: number; planValues: unknown }) {
  if (!run.planId) return null;
  const plan = await db.testPlan.findUnique({ where: { id: run.planId }, select: { number: true, name: true, runs: { orderBy: { number: "asc" }, select: { number: true, planValues: true } } } });
  if (!plan) return null;
  const at = plan.runs.findIndex((r) => r.number === run.number);
  const side = (i: number) => (plan.runs[i] ? { number: plan.runs[i].number, values: parsePlanValues(plan.runs[i].planValues) } : null);
  return { number: plan.number, name: plan.name, values: parsePlanValues(run.planValues), prev: at > 0 ? side(at - 1) : null, next: at >= 0 ? side(at + 1) : null, count: plan.runs.length };
}

/** For the runs lists: plans of these runs, by id, with name and number. */
export async function plansByIds(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, { id: string; number: number; name: string; runCount: number }>();
  const plans = await db.testPlan.findMany({ where: { id: { in: unique } }, select: { id: true, number: true, name: true, _count: { select: { runs: true } } } });
  return new Map(plans.map((p) => [p.id, { id: p.id, number: p.number, name: p.name, runCount: p._count.runs }]));
}
