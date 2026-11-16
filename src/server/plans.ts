"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireProjectAction, requireUser } from "@/lib/session";
import { loadUmbrella, umbrellaOf } from "@/lib/umbrella";
import { logActivity } from "@/lib/activity";
import { runFinished } from "@/lib/slack";
import { OPEN } from "@/lib/status";
import {
  configId,
  MAX_CONFIGURATIONS,
  MAX_PLAN_RUNS,
  MAX_VALUE_LENGTH,
  MAX_VALUES,
  pairings,
  parseConfigurations,
  parsePlanConfigs,
  splitEvenly,
  valuesFromText,
  type Configuration,
  type PlanConfig,
} from "@/lib/configurations";
import { addPlanRuns, makePlan, parsePlanDetails, parsePlanSource, runSourceFor } from "@/lib/plans-server";
import { attempt, UserError } from "./result";
import type { Prisma } from "@prisma/client";

// Configurations (umbrella Settings) and the test plan page's tools.

const configsSchema = z
  .array(
    z.object({
      id: z.string().max(40).optional(),
      name: z.string().trim().min(1, "Name every Configuration.").max(60, "Keep names under 60 characters."),
      /** One per line, as typed or pasted from a sheet. */
      values: z.string().max(MAX_VALUES * (MAX_VALUE_LENGTH + 2)),
    }),
  )
  .max(MAX_CONFIGURATIONS, `An umbrella can have up to ${MAX_CONFIGURATIONS} Configurations.`);

/**
 * Umbrella Settings → Configurations: add, edit or remove them. Runs and plans already made
 * keep their own copy of the values, so old results stay true.
 */
export async function setConfigurations(groupId: string, input: z.input<typeof configsSchema>) {
  return attempt(async () => {
    const list = configsSchema.parse(input);
    const user = await requireUser();
    const umbrella = await loadUmbrella(groupId, user);
    if (!umbrella || !can(umbrella.who, "umbrella:fields")) throw new UserError("You can't change Configurations in this umbrella.");
    if (umbrella.group.archivedAt) throw new UserError("This umbrella is archived.");
    const seen = new Set<string>();
    const ids: string[] = [];
    const out: Configuration[] = list.map((c) => {
      const low = c.name.toLowerCase();
      if (seen.has(low)) throw new UserError(`There's already a Configuration called ${c.name}.`);
      seen.add(low);
      const values = valuesFromText(c.values);
      if (!values.length) throw new UserError(`Add at least one value to ${c.name}, one per line.`);
      if (values.length > MAX_VALUES) throw new UserError(`${c.name} has ${values.length} values. Keep it to ${MAX_VALUES}.`);
      const id = c.id && !ids.includes(c.id) ? c.id : configId(c.name, ids);
      ids.push(id);
      return { id, name: c.name, values };
    });
    await db.projectGroup.update({ where: { id: groupId }, data: { configurations: out as unknown as Prisma.InputJsonValue } });
    await logActivity({ actor: user, kind: "settings", action: "Changed Configurations", group: umbrella.group, detail: out.map((c) => `${c.name} (${c.values.length})`).join(", ") });
    revalidatePath(`/g/${groupId}`, "layout");
    return { configurations: out };
  });
}

async function planIn(projectId: string, planId: string) {
  const plan = await db.testPlan.findFirst({ where: { id: planId, projectId }, include: { runs: { orderBy: { number: "asc" }, select: { id: true, number: true, state: true, planValues: true } } } });
  if (!plan) throw new UserError("That test plan isn't here anymore.");
  return plan;
}

const addSchema = z.object({
  /** The Configuration getting a new value, by name as the plan has it. */
  name: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1, "Type or pick a value.").max(MAX_VALUE_LENGTH),
  /** Also add a typed value to the umbrella's Configuration, for next time. */
  remember: z.boolean().default(false),
});

/**
 * "+ Add a run for another value": a new value arrives mid-RC. With two Configurations it
 * pairs the new value with each value of the other one, so it can add a few runs.
 */
export async function addPlanValue(projectId: string, planId: string, input: z.input<typeof addSchema>) {
  return attempt(async () => {
    const data = addSchema.parse(input);
    const { project, user } = await requireProjectAction(projectId, "run:create");
    const plan = await planIn(projectId, planId);
    if (plan.state === "COMPLETED") throw new UserError("This test plan is closed. Reopen it to add a run.");
    const configs = parsePlanConfigs(plan.configs);
    const at = configs.findIndex((c) => c.name === data.name);
    if (at < 0) throw new UserError("This test plan doesn't use that Configuration.");
    if (configs[at].values.some((v) => v.toLowerCase() === data.value.toLowerCase())) throw new UserError(`${data.value} is already in this test plan.`);
    const combos = pairings(configs.map((c, i) => (i === at ? { name: c.name, values: [data.value] } : c)));
    if (plan.runs.length + combos.length > MAX_PLAN_RUNS) throw new UserError(`A test plan holds up to ${MAX_PLAN_RUNS} runs, and this would make ${plan.runs.length + combos.length}.`);
    const source = await runSourceFor(project, parsePlanSource(plan.source));
    const next: PlanConfig[] = configs.map((c, i) => (i === at ? { name: c.name, values: [...c.values, data.value] } : c));
    await db.testPlan.update({ where: { id: plan.id }, data: { configs: next as unknown as Prisma.InputJsonValue } });
    const made = await addPlanRuns(project, plan, combos, source, parsePlanDetails(plan.details), null);
    let remembered = false;
    if (data.remember) {
      const u = await umbrellaOf(project);
      const umbrella = u ? await loadUmbrella(u.group.id, user) : null;
      if (umbrella && can(umbrella.who, "umbrella:fields")) {
        const list = parseConfigurations(umbrella.group.configurations);
        const c = list.find((x) => x.name === data.name);
        if (c && !c.values.some((v) => v.toLowerCase() === data.value.toLowerCase()) && c.values.length < MAX_VALUES) {
          c.values.push(data.value);
          await db.projectGroup.update({ where: { id: umbrella.group.id }, data: { configurations: list as unknown as Prisma.InputJsonValue } });
          remembered = true;
        }
      }
    }
    await logActivity({ actor: user, kind: "run", action: `Added ${data.value} to test plan "${plan.name}"`, project, detail: `${made.length} run${made.length === 1 ? "" : "s"}` });
    revalidatePath(`/p/${project.key}`, "layout");
    return { runs: made.length, remembered };
  });
}

/**
 * "Copy to another test cycle": the same plan, values and cases in the next RC, with fresh
 * results. Release becomes that test cycle's own when the plan had this one's; Version starts blank.
 */
export async function copyPlan(projectId: string, planId: string, targetId: string) {
  return attempt(async () => {
    const { project: from } = await requireProjectAction(projectId, "run:create");
    const { project: to, user } = await requireProjectAction(targetId, "run:create");
    if (from.id === to.id) throw new UserError("Pick a different test cycle to copy it to.");
    const [a, b] = await Promise.all([umbrellaOf(from), umbrellaOf(to)]);
    if (!a || !b || a.group.id !== b.group.id) throw new UserError("Copy a test plan to a test cycle in the same umbrella.");
    if (to.archivedAt) throw new UserError(`${to.name} is archived.`);
    const plan = await planIn(projectId, planId);
    const details = parsePlanDetails(plan.details);
    const release = !details.release || details.release === from.rcName ? to.rcName : details.release;
    const made = await makePlan(to, user, { name: plan.name, configs: parsePlanConfigs(plan.configs), source: parsePlanSource(plan.source), details: { ...details, release, build: "" } });
    revalidatePath(`/p/${to.key}`, "layout");
    return { key: to.key, number: made.planNumber, runs: made.runs.length };
  });
}

/** Close the plan: closes all its runs at once (or reopens them all). */
export async function setPlanState(projectId: string, planId: string, state: "ACTIVE" | "COMPLETED") {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:manage");
    const plan = await planIn(projectId, planId);
    const closing = state === "COMPLETED";
    const changing = plan.runs.filter((r) => r.state !== state).map((r) => r.id);
    // Runs closed with cases still to test count as finished then, like Close run.
    const unfinished = closing ? await db.testRun.findMany({ where: { id: { in: changing }, entries: { some: { status: { in: OPEN } } } }, select: { id: true } }) : [];
    await db.$transaction([
      db.testRun.updateMany({ where: { id: { in: changing } }, data: { state, completedAt: closing ? new Date() : null } }),
      db.testPlan.update({ where: { id: plan.id }, data: { state, completedAt: closing ? new Date() : null } }),
    ]);
    for (const r of unfinished) await runFinished(project, r.id, true).catch(() => {});
    await logActivity({ actor: user, kind: "run", action: `${closing ? "Closed" : "Reopened"} test plan "${plan.name}"`, project, detail: `${changing.length} run${changing.length === 1 ? "" : "s"}` });
    revalidatePath(`/p/${project.key}`, "layout");
    return { runs: changing.length };
  });
}

/** Give one of the plan's runs to a tester: every case in it. null takes them off everyone. */
export async function assignPlanRun(projectId: string, planId: string, runId: string, userId: string | null) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:assign");
    const plan = await planIn(projectId, planId);
    if (!plan.runs.some((r) => r.id === runId)) throw new UserError("That run isn't in this test plan.");
    if (userId && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } }))) throw new UserError("That person isn't a member of this test cycle.");
    await db.runEntry.updateMany({ where: { runId }, data: { assigneeId: userId } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

/** "Split evenly": the plan's open runs shared out in turn across the picked testers. */
export async function splitPlan(projectId: string, planId: string, userIds: string[]) {
  return attempt(async () => {
    const people = z.array(z.string().max(40)).min(1, "Tick at least one tester.").max(50).parse(userIds);
    const { project, user } = await requireProjectAction(projectId, "run:assign");
    const plan = await planIn(projectId, planId);
    const members = await db.projectMember.count({ where: { projectId, userId: { in: people } } });
    if (members !== new Set(people).size) throw new UserError("Someone you ticked isn't a member of this test cycle.");
    const open = plan.runs.filter((r) => r.state === "ACTIVE");
    const plan2 = splitEvenly(open.map((r) => r.id), people);
    await db.$transaction([...plan2].map(([runId, who]) => db.runEntry.updateMany({ where: { runId }, data: { assigneeId: who } })));
    await logActivity({ actor: user, kind: "run", action: `Shared out test plan "${plan.name}"`, project, detail: `${open.length} runs across ${people.length} tester${people.length === 1 ? "" : "s"}` });
    revalidatePath(`/p/${project.key}`, "layout");
    return { runs: open.length };
  });
}
