"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { libraryProjectIds } from "@/lib/umbrella";
import { undoFill } from "@/lib/sisters-server";
import { attempt, UserError } from "./result";

// Sister cases: link a dry run case to the cases it shares a test with, and undo a fill.

const linkSchema = z.object({
  fromCaseId: z.string().min(1),
  fromClient: z.string().max(80).default(""),
  toCaseId: z.string().min(1),
  steps: z.array(z.string().max(200)).max(500).default([]),
});

/** Link (or relink) a dry run case to a sister case in this Case library, with the steps it covers. */
export async function saveSisterLink(projectId: string, input: z.input<typeof linkSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const data = linkSchema.parse(input);
    const library = await libraryProjectIds(project);
    const to = await db.testCase.findFirst({ where: { id: data.toCaseId, projectId: { in: library } }, select: { id: true } });
    if (!to) throw new UserError("That case isn't in this Case library.");
    const from = await db.testCase.findUnique({ where: { id: data.fromCaseId }, select: { id: true, projectId: true, project: { select: { key: true } } } });
    if (!from) throw new UserError("That dry run case no longer exists.");
    if (from.id === to.id) throw new UserError("A case can't be its own sister.");
    await requireProjectAction(from.projectId, "case:edit");
    const steps = [...new Set(data.steps.filter(Boolean))];
    const link = await db.sisterLink.upsert({
      where: { fromCaseId_fromClient_toCaseId: { fromCaseId: from.id, fromClient: data.fromClient.trim(), toCaseId: to.id } },
      create: { fromCaseId: from.id, fromClient: data.fromClient.trim(), toCaseId: to.id, steps, createdById: user.id, createdBy: user.name ?? user.email },
      update: { steps },
    });
    revalidatePath(`/p/${project.key}/cases`, "layout");
    revalidatePath(`/p/${from.project.key}/cases`, "layout");
    return { id: link.id };
  });
}

/** Take a sister link away. Steps it filled before keep their results. */
export async function removeSisterLink(projectId: string, linkId: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "case:edit");
    const library = await libraryProjectIds(project);
    const link = await db.sisterLink.findFirst({ where: { id: linkId, OR: [{ toCase: { projectId: { in: library } } }, { fromCase: { projectId: { in: library } } }] } });
    if (!link) throw new UserError("That link is already gone.");
    await db.sisterLink.delete({ where: { id: link.id } });
    revalidatePath(`/p/${project.key}/cases`, "layout");
    return {};
  });
}

/** Undo what a dry run save filled in: the "Also filled in the RC" line's Undo. */
export async function undoSisterFill(at: string, entryIds: string[]) {
  return attempt(async () => {
    const ids = z.array(z.string().min(1)).max(100).parse(entryIds);
    const when = z.string().datetime().parse(at);
    const entries = await db.runEntry.findMany({ where: { id: { in: ids } }, select: { id: true, run: { select: { projectId: true, project: { select: { key: true } } } } } });
    let undone = 0;
    for (const e of entries) {
      const { user } = await requireProjectAction(e.run.projectId, "run:execute");
      undone += await undoFill(e.id, when, { id: user.id, name: user.name ?? user.email });
      revalidatePath(`/p/${e.run.project.key}`, "layout");
    }
    if (!undone) throw new UserError("Nothing to undo: someone has changed those steps since.");
    return { undone };
  });
}
