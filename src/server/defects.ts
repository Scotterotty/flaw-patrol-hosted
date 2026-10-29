"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { severitySchema } from "@/lib/severity";
import { attempt } from "./result";

const defectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().max(10000).default(""),
  severity: severitySchema,
  status: z.enum(["OPEN", "FIXED", "CLOSED", "WONT_FIX"]),
  externalKey: z.string().trim().max(100).nullable().default(null),
  externalUrl: z.string().trim().url("Enter a full link starting with https://").max(1000).nullable().or(z.literal("")).default(null),
});
export type DefectInput = z.input<typeof defectSchema>;

export async function updateDefect(projectId: string, defectId: string, input: DefectInput) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "defect:edit");
    const data = defectSchema.parse(input);
    const before = await db.defect.findFirst({ where: { id: defectId, projectId }, select: { status: true, fixedById: true } });
    if (!before) return {};
    // Remember who marked it fixed: bug XP only pays when that's someone other than the filer (or Jira says done).
    const fixed = data.status === "FIXED" || data.status === "CLOSED";
    const wasFixed = before.status === "FIXED" || before.status === "CLOSED";
    const fixedById = fixed ? (wasFixed ? before.fixedById : user.id) : null;
    await db.defect.updateMany({
      where: { id: defectId, projectId },
      data: { ...data, externalKey: data.externalKey || null, externalUrl: data.externalUrl || null, fixedById },
    });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
