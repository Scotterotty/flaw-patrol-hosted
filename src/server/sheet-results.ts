"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { matchTester } from "@/lib/run-import";
import { requireProjectAction } from "@/lib/session";
import { libraryProjectIds, umbrellaOf } from "@/lib/umbrella";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";
import { createCycleFromRunBox } from "./start-run";

const resultSchema = z
  .object({
    status: z.enum(["PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED"]),
    tester: z.string().trim().max(200).default(""),
    notes: z.string().max(10000).default(""),
  })
  .nullable();

const inputSchema = z.object({
  /** The test cycle the run goes in, or null with newCycle to make the umbrella's first one. */
  cycleId: z.string().max(40).nullable(),
  newCycle: z.object({ groupId: z.string().max(40), name: z.string().trim().min(1, "Name the test cycle").max(100) }).nullable().default(null),
  /** The cases Import just made, in the file's order, with each one's result from the sheet. */
  caseIds: z.array(z.string().max(40)).max(5000),
  results: z.array(resultSchema).max(5000),
  testedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date they were tested"),
  fileName: z.string().max(300).default(""),
});

/**
 * Bring your Google Sheet, results and all (ver_217): right after Import makes the cases, the
 * sheet's Pass, Fail and Blocked come in as one finished run, "From my sheet", dated the day
 * they were tested. Notes become the result's comment; testers are matched to the team by name,
 * or kept as the name the sheet had. Cases with no result are left out of the run.
 */
export async function importSheetResults(raw: z.input<typeof inputSchema>) {
  return attempt(async () => {
    const input = inputSchema.parse(raw);
    if (input.caseIds.length !== input.results.length) throw new UserError("The results don't line up with the cases. Import the file again.");
    let cycleId = input.cycleId;
    if (!cycleId) {
      if (!input.newCycle) throw new UserError("Pick the test cycle for the run.");
      const made = await createCycleFromRunBox(input.newCycle.groupId, { name: input.newCycle.name, platform: "" });
      if (!made.ok) throw new UserError(made.error);
      cycleId = made.cycle.id;
    }
    const { project, user } = await requireProjectAction(cycleId, "run:import");
    if ((await umbrellaOf(project))?.isHub) throw new UserError("Pick a test cycle for the run.");
    const libIds = await libraryProjectIds(project);
    const picked = input.caseIds.flatMap((id, i) => (input.results[i] ? [{ id, result: input.results[i]! }] : []));
    if (!picked.length) throw new UserError("None of the cases has a result in the sheet.");
    const entries = await buildEntries(db as unknown as Parameters<typeof buildEntries>[0], libIds, picked.map((p) => p.id), null);
    if (entries.length !== picked.length) throw new UserError("Some of the cases aren't in this test cycle's library. Pick another test cycle.");

    const [memberRows, saved] = await Promise.all([
      db.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true, user: { select: { name: true, email: true } } } }),
      db.project.findUniqueOrThrow({ where: { id: project.id }, select: { runImportAliases: true } }),
    ]);
    const members = memberRows.map((m) => ({ id: m.userId, name: m.user.name ?? "", email: m.user.email }));
    const aliases = (saved.runImportAliases ?? {}) as Record<string, string>;
    // Noon UTC, so the date reads the same in the US and the UK; never later than now.
    const at = new Date(Math.min(new Date(`${input.testedOn}T12:00:00Z`).getTime(), Date.now()));
    const resultOf = new Map(picked.map((p) => [p.id, p.result]));

    const run = await db.$transaction(
      async (tx) => {
        const { runSeq } = await tx.project.update({ where: { id: project.id }, data: { runSeq: { increment: 1 } } });
        const created = await tx.testRun.create({
          data: {
            projectId: project.id,
            number: runSeq,
            name: "From my sheet",
            description: `Imported from ${input.fileName || "a spreadsheet"}`,
            state: "COMPLETED",
            completedAt: at,
            createdAt: at,
            createdById: user.id,
            createdBy: user.name ?? user.email,
            entries: { create: entries.map(({ assigneeId, ...e }) => (void assigneeId, e)) },
          },
          include: { entries: { select: { id: true, caseId: true, caseVersion: true, steps: true } } },
        });
        for (const e of created.entries) {
          const r = resultOf.get(e.caseId)!;
          const member = r.tester ? matchTester(r.tester, members, aliases) : null;
          const steps = Array.isArray(e.steps) ? e.steps.length : 0;
          const stepResults = Array.from({ length: steps }, () => ({ status: "UNTESTED", actual: "" }));
          await tx.testResult.create({
            data: {
              entryId: e.id,
              runId: created.id,
              caseId: e.caseId,
              caseVersion: e.caseVersion,
              status: r.status,
              stepResults: stepResults as Prisma.InputJsonValue,
              comment: r.notes,
              testerId: member?.id ?? null,
              testerName: member ? member.name || member.email : r.tester,
              imported: true,
              createdAt: at,
            },
          });
          await tx.runEntry.update({ where: { id: e.id }, data: { status: r.status, lastTestedAt: at, assigneeId: member?.id ?? null } });
        }
        return created;
      },
      { timeout: 180_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Imported ${picked.length} results from a spreadsheet as the finished run "From my sheet"`, detail: input.fileName, project });
    revalidatePath(`/p/${project.key}`, "layout");
    if (project.groupId) revalidatePath(`/g/${project.groupId}`, "layout");
    return { number: run.number, projectKey: project.key, results: picked.length, cycleName: project.name };
  });
}
