import "server-only";
import type { Prisma, Project } from "@prisma/client";
import { db } from "@/lib/db";
import { NOT_BASH_CASE } from "@/lib/bash-cases";
import { ONLY_AUTOMATED } from "@/lib/automated-cases";
import { libraryProjectIds, umbrellaOf } from "@/lib/umbrella";
import { logActivity } from "@/lib/activity";
import { MAX_PLAN_RUNS, pairings, planRunName, type PlanConfig, type PlanValue } from "@/lib/configurations";
import { createRun, type RunInput } from "@/server/runs";
import { UserError } from "@/server/result";

// Test plans, server side: what a plan runs, and making its runs. The actions people press
// are in src/server/plans.ts; Create a run's ticks come through startRuns.

/** What a plan's runs test, as Create a run picked it. Kept on the plan for Add a run and Copy. */
export type PlanSource = { what: "all" | "suite" | "cases"; suiteId?: string; caseIds?: string[]; withAutomated: boolean };
/** The run details a plan's runs share. */
export type PlanDetails = Omit<RunInput, "name" | "assigneeId">;

export function parsePlanSource(raw: unknown): PlanSource {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PlanSource>;
  const what = r.what === "suite" || r.what === "cases" ? r.what : "all";
  return { what, suiteId: typeof r.suiteId === "string" ? r.suiteId : undefined, caseIds: Array.isArray(r.caseIds) ? r.caseIds.filter((x): x is string => typeof x === "string") : undefined, withAutomated: !!r.withAutomated };
}

export function parsePlanDetails(raw: unknown): PlanDetails {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  const fields = r.fields && typeof r.fields === "object" ? Object.fromEntries(Object.entries(r.fields as Record<string, unknown>).filter(([, v]) => typeof v === "string")) : {};
  return { release: str("release"), build: str("build"), cspVersion: str("cspVersion"), environment: str("environment"), description: str("description"), runKind: str("runKind"), withAutomated: !!r.withAutomated, fields: fields as Record<string, string> };
}

/**
 * The cases a run in this test cycle tests, from Create a run's pick: a suite, ticked cases,
 * or the whole Case library (leaving out automated-only cases unless asked for).
 */
export async function runSourceFor(project: Pick<Project, "id" | "groupId" | "name">, spec: PlanSource): Promise<Parameters<typeof createRun>[1]> {
  if (spec.what === "suite") {
    if (!spec.suiteId) throw new UserError("Pick a suite to run.");
    return { kind: "suite", suiteId: spec.suiteId };
  }
  const u = await umbrellaOf(project);
  // The whole library is the umbrella's Case library; outside an umbrella, the project's own cases.
  const ids = spec.what === "all" ? (u && !u.isHub ? [u.hub.id] : [project.id]) : await libraryProjectIds(project);
  const cases = await db.testCase.findMany({
    // The whole library never takes in a bug bash's area charters.
    where: { projectId: { in: ids }, archived: false, ...(spec.what === "cases" ? { id: { in: spec.caseIds ?? [] } } : { ...NOT_BASH_CASE, ...(spec.withAutomated ? {} : { type: { not: "AUTOMATED" as const } }) }) },
    orderBy: [{ projectId: "asc" }, { number: "asc" }],
    select: { id: true },
  });
  const order = spec.what === "cases" ? new Map((spec.caseIds ?? []).map((id, i) => [id, i])) : null;
  const caseIds = cases.map((c) => c.id).sort((a, b) => (order ? order.get(a)! - order.get(b)! : 0));
  if (!caseIds.length && spec.what === "all" && !spec.withAutomated) throw new UserError(ONLY_AUTOMATED);
  if (!caseIds.length) throw new UserError(`${project.name} has none of these cases to run.`);
  return { kind: "cases", caseIds };
}

type Actor = { id: string; name: string | null; email: string };

/**
 * Make a test plan in one test cycle: the plan, then one normal run per value (or pairing).
 * The caller has checked run:create there. Runs already made stay if a later one fails,
 * and the error says how far it got.
 */
export async function makePlan(
  project: Project,
  user: Actor,
  input: { name: string; configs: PlanConfig[]; source: PlanSource; details: PlanDetails; assigneeId?: string | null },
): Promise<{ planNumber: number; planId: string; runs: { number: number }[] }> {
  const combos = pairings(input.configs);
  if (!combos.length) throw new UserError("Tick at least one value to test on.");
  if (combos.length > MAX_PLAN_RUNS) throw new UserError(`That makes ${combos.length} runs. A test plan holds up to ${MAX_PLAN_RUNS}, so untick some values.`);
  const configs = input.configs.filter((c) => c.values.length);
  const source = await runSourceFor(project, input.source);
  const plan = await db.$transaction(async (tx) => {
    const { planSeq } = await tx.project.update({ where: { id: project.id }, data: { planSeq: { increment: 1 } } });
    return tx.testPlan.create({
      data: {
        projectId: project.id,
        number: planSeq,
        name: input.name,
        configs: configs as unknown as Prisma.InputJsonValue,
        source: input.source as unknown as Prisma.InputJsonValue,
        details: input.details as unknown as Prisma.InputJsonValue,
        createdById: user.id,
        createdBy: user.name ?? user.email,
      },
    });
  });
  const runs = await addPlanRuns(project, plan, combos, source, input.details, input.assigneeId ?? null);
  await logActivity({ actor: user, kind: "run", action: `Started test plan "${plan.name}"`, project, detail: `${runs.length} runs: ${configs.map((c) => c.name).join(" × ")}` });
  return { planNumber: plan.number, planId: plan.id, runs };
}

/** Make a plan's runs, one per set of values. */
export async function addPlanRuns(
  project: Pick<Project, "id" | "name">,
  plan: { id: string; name: string },
  combos: PlanValue[][],
  source: Parameters<typeof createRun>[1],
  details: PlanDetails,
  assigneeId: string | null,
) {
  const made: { number: number }[] = [];
  for (const values of combos) {
    const res = await createRun(project.id, source, { ...details, name: planRunName(plan.name, values), assigneeId }, { planId: plan.id, values, quiet: true });
    if (!res.ok) {
      if (!made.length) {
        await db.testPlan.deleteMany({ where: { id: plan.id, runs: { none: {} } } });
        throw new UserError(`${project.name}: ${res.error}`);
      }
      throw new UserError(`Made ${made.length} of ${combos.length} runs in ${plan.name}, then stopped: ${res.error}`);
    }
    made.push({ number: res.number });
  }
  return made;
}
