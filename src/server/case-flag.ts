"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FLAG_REASONS, type FlagReason } from "@/lib/case-flag";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { libraryProjectIds } from "@/lib/umbrella";
import { attempt, UserError } from "./result";

const flagSchema = z.object({
  reason: z.enum(Object.keys(FLAG_REASONS) as [FlagReason, ...FlagReason[]]),
  note: z.string().trim().max(2000).default(""),
  runNumber: z.number().int().positive().nullable().default(null),
});

/** Flag a case as needing updating or other attention, usually from a run. Flagging again replaces the reason and note. */
export async function flagCase(projectId: string, caseId: string, input: z.input<typeof flagSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:flag");
    const data = flagSchema.parse(input);
    const { count } = await db.testCase.updateMany({
      // From a run in an umbrella's project, the case may live in the umbrella's library.
      where: { id: caseId, projectId: { in: await libraryProjectIds(project) } },
      data: { flag: data.reason, flagNote: data.note, flaggedBy: user.name ?? user.email, flaggedAt: new Date(), flagRunNumber: data.runNumber },
    });
    if (!count) throw new UserError("This case no longer exists.");
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

/** The case has been dealt with. */
export async function clearCaseFlag(projectId: string, caseId: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "case:flag");
    await db.testCase.updateMany({ where: { id: caseId, projectId: { in: await libraryProjectIds(project) } }, data: { flag: null, flagNote: "", flaggedBy: "", flaggedAt: null, flagRunNumber: null } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
