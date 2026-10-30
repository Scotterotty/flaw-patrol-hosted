"use server";

import { logActivity } from "@/lib/activity";
import { Prisma, type ResultStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { libraryProjectIds, parseCarryOver } from "@/lib/umbrella";
import { alertRunStarted, runFinished } from "@/lib/slack";
import { OPEN } from "@/lib/status";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";
import { fieldsOrFail } from "./run-field-input";
import { parseFieldValues } from "@/lib/run-fields";
import { suiteForCases } from "@/lib/suite-match";

const runSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().max(5000).default(""),
  build: z.string().trim().max(200).default(""),
  cspVersion: z.string().trim().max(200).default(""),
  environment: z.string().trim().max(200).default(""),
  release: z.string().trim().max(200).default(""),
  /** The run kind (ver_95), see src/lib/run-kinds.ts. A rerun keeps the run's own. */
  runKind: z.string().trim().max(40).default(""),
  assigneeId: z.string().nullable().default(null),
  /** The umbrella's run fields, by field id (ver_89). "csp" fills cspVersion. */
  fields: z.record(z.string(), z.string().max(200)).default({}),
});
export type RunInput = z.input<typeof runSchema>;

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("suite"), suiteId: z.string() }),
  z.object({ kind: z.literal("cases"), caseIds: z.array(z.string()).min(1).max(5000) }),
  z.object({
    kind: z.literal("rerun"),
    runId: z.string(),
    statuses: z.array(z.enum(["UNTESTED", "PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED", "IN_PROGRESS", "EXPLORED"])).min(1),
  }),
]);

export async function createRun(projectId: string, from: z.input<typeof source>, input: RunInput) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:create");
    const data = runSchema.parse(input);
    const src = source.parse(from);
    if (data.assigneeId) {
      const m = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: data.assigneeId } } });
      if (!m) throw new UserError("That person isn't a member of this test cycle.");
    }

    const typed = await fieldsOrFail(projectId, { csp: data.cspVersion, ...data.fields });
    const library = await libraryProjectIds(project);
    const run = await db.$transaction(
      async (tx) => {
        let caseIds: string[];
        let suiteId: string | null = null;
        let runKind = data.runKind;
        let suiteVersion: number | null = null;
        if (src.kind === "suite") {
          const suite = await tx.testSuite.findFirst({ where: { id: src.suiteId, projectId: { in: library } }, include: { cases: { orderBy: { position: "asc" } } } });
          if (!suite) throw new UserError("Suite not found.");
          suiteId = suite.id;
          suiteVersion = suite.currentVersion;
          caseIds = suite.cases.map((c) => c.caseId);
        } else if (src.kind === "rerun") {
          const prev = await tx.testRun.findFirst({
            where: { id: src.runId, projectId },
            include: { entries: { where: { status: { in: src.statuses as ResultStatus[] } }, orderBy: { position: "asc" } } },
          });
          if (!prev) throw new UserError("Run not found.");
          suiteId = prev.suiteId;
          suiteVersion = prev.suiteVersion;
          caseIds = prev.entries.map((e) => e.caseId);
          runKind = prev.kind;
        } else {
          caseIds = src.caseIds;
        }
        // The first run in a test cycle started with "No runs yet" gets the last release's
        // testers (where nobody was picked) and its open-bug cases first (ver_91).
        const carry = src.kind !== "rerun" ? parseCarryOver(project.carryOver) : null;
        if (carry?.recheck.length) {
          const first = new Set(carry.recheck);
          caseIds = [...caseIds.filter((id) => first.has(id)), ...caseIds.filter((id) => !first.has(id))];
        }
        const entries = await buildEntries(tx, library, caseIds, data.assigneeId);
        if (!entries.length) throw new UserError("There are no active cases to run.");
        if (carry && !data.assigneeId) {
          const team = new Set((await tx.projectMember.findMany({ where: { projectId }, select: { userId: true } })).map((m) => m.userId));
          for (const e of entries) {
            const who = carry.assigned[e.caseId];
            if (who && team.has(who)) e.assigneeId = who;
          }
        }
        if (project.carryOver !== null) await tx.project.update({ where: { id: projectId }, data: { carryOver: Prisma.DbNull } });
        if (src.kind === "cases") {
          // Picked cases that are exactly a suite's cases make that suite's run.
          const suites = await tx.testSuite.findMany({
            where: { projectId: { in: library }, archived: false },
            orderBy: { name: "asc" },
            select: { id: true, currentVersion: true, cases: { where: { testCase: { archived: false } }, select: { caseId: true } } },
          });
          const match = suiteForCases(suites.map((s) => ({ ...s, caseIds: s.cases.map((c) => c.caseId) })), entries.map((e) => e.caseId));
          if (match) ({ id: suiteId, currentVersion: suiteVersion } = match);
        }
        const { runSeq } = await tx.project.update({ where: { id: projectId }, data: { runSeq: { increment: 1 } } });
        return tx.testRun.create({
          data: {
            projectId,
            number: runSeq,
            suiteId,
            suiteVersion,
            name: data.name,
            description: data.description,
            build: data.build,
            cspVersion: typed.cspVersion ?? "",
            fields: typed.fields,
            environment: data.environment,
            release: data.release,
            kind: runKind,
            createdById: user.id,
            createdBy: user.name ?? user.email,
            entries: { create: entries.map(({ assigneeId, ...e }) => ({ ...e, assigneeId })) },
          },
        });
      },
      { timeout: 60_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Started run R${run.number} "${run.name}"`, project, detail: run.release ? `Release ${run.release}` : "" });
    revalidatePath(`/p/${project.key}`, "layout");
    await alertRunStarted(project, run.id, user.name ?? user.email).catch(() => {});
    return { number: run.number };
  });
}

/** Change a run's name, release, build, environment or notes. Anyone who can start runs can. */
export async function updateRun(projectId: string, runId: string, input: RunInput) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:create");
    // The kind and assignee are picked when a run starts; Edit details doesn't change them.
    const { assigneeId: _ignored, runKind: _kind, fields: input2, cspVersion, ...data } = runSchema.parse(input); // eslint-disable-line @typescript-eslint/no-unused-vars
    const run = await db.testRun.findFirst({ where: { id: runId, projectId }, select: { fields: true } });
    if (!run) throw new UserError("Run not found.");
    const typed = await fieldsOrFail(projectId, { csp: cspVersion, ...input2 }, { strict: false });
    // Fields the umbrella has since removed keep their values on this run.
    const kept = parseFieldValues(run.fields).filter((f) => !typed.defs.some((d) => d.id === f.id));
    await db.testRun.updateMany({ where: { id: runId, projectId }, data: { ...data, cspVersion: typed.cspVersion, fields: [...typed.fields, ...kept] } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

export async function setRunState(projectId: string, runId: string, state: "ACTIVE" | "COMPLETED") {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:manage");
    const before = await db.testRun.findFirst({ where: { id: runId, projectId }, select: { state: true, name: true, number: true, createdAt: true, _count: { select: { entries: { where: { status: { in: OPEN } } } } } } });
    await db.testRun.updateMany({
      where: { id: runId, projectId },
      data: { state, completedAt: state === "COMPLETED" ? new Date() : null },
    });
    if (before && before.state !== state) {
      const days = Math.max(1, Math.round((Date.now() - before.createdAt.getTime()) / 86_400_000));
      await logActivity({ actor: user, kind: "run", action: `${state === "COMPLETED" ? "Closed" : "Reopened"} run R${before.number} "${before.name}"`, project, detail: state === "COMPLETED" ? `Was open ${days} day${days === 1 ? "" : "s"}` : "" });
    }
    // Closed before every case had a result: that's when the run counts as finished.
    if (state === "COMPLETED" && before?.state === "ACTIVE" && before._count.entries > 0) await runFinished(project, runId, true).catch(() => {});
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

export async function deleteRun(projectId: string, runId: string) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:delete");
    const run = await db.testRun.findFirst({ where: { id: runId, projectId }, select: { name: true, number: true } });
    await db.testRun.deleteMany({ where: { id: runId, projectId } });
    if (run) await logActivity({ actor: user, kind: "delete", action: `Deleted run R${run.number} "${run.name}"`, project });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

/**
 * Testers can take an unassigned case for themselves, or let go of their own,
 * so nobody else starts on it. Reassigning someone else's case stays with leads.
 */
/** Take a case (or let it go). `over` takes it from whoever has it, after they asked or left. */
export async function takeEntry(projectId: string, entryId: string, take: boolean, over = false) {
  return attempt(async () => {
    const { user, project } = await requireProjectAction(projectId, "run:execute");
    const entry = await db.runEntry.findFirst({ where: { id: entryId, run: { projectId } }, include: { run: true } });
    if (!entry) throw new UserError("Case not found.");
    if (entry.run.state === "COMPLETED") throw new UserError("This run is closed.");
    if (take && over) {
      await db.runEntry.update({ where: { id: entryId }, data: { assigneeId: user.id } });
      revalidatePath(`/p/${project.key}`, "layout");
      return {};
    }
    if (take && entry.assigneeId && entry.assigneeId !== user.id) throw new UserError("Someone else has just taken this case.");
    if (!take && entry.assigneeId !== user.id) return {};
    // Only claim it if it's still free, in case two people click at once.
    const { count } = await db.runEntry.updateMany({
      where: { id: entryId, assigneeId: take ? null : user.id },
      data: { assigneeId: take ? user.id : null },
    });
    if (take && count === 0 && entry.assigneeId !== user.id) throw new UserError("Someone else has just taken this case.");
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

export async function assignEntries(projectId: string, runId: string, entryIds: string[], assigneeId: string | null) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:assign");
    if (assigneeId && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } }))) {
      throw new UserError("That person isn't a member of this test cycle.");
    }
    const run = await db.testRun.findFirst({ where: { id: runId, projectId } });
    if (!run) throw new UserError("Run not found.");
    const { count } = await db.runEntry.updateMany({ where: { id: { in: entryIds }, runId }, data: { assigneeId } });
    revalidatePath(`/p/${project.key}`, "layout");
    return { count };
  });
}
