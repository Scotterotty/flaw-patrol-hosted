"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { cleanReportQuery } from "@/lib/report-query";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

const saveSchema = z.object({
  name: z.string().trim().min(1, "Give the view a name").max(80),
  query: z.string().max(2000),
  shared: z.boolean().default(true),
});

/** Save the Reports page's current filters under a name, for the team or just yourself. */
export async function saveReportView(projectId: string, input: z.input<typeof saveSchema>) {
  return attempt(async () => {
    const { user, project } = await requireProjectAction(projectId, "run:execute");
    const data = saveSchema.parse(input);
    const query = cleanReportQuery(data.query);
    const view = await db.savedReport.create({
      data: { projectId, name: data.name, query, shared: data.shared, createdById: user.id, createdByName: user.name ?? user.email },
    });
    revalidatePath(`/p/${project.key}/reports`);
    return { id: view.id, query };
  });
}

/** Whoever saved a view can delete it; admins can delete shared ones too (ver_96: deleting stays with admins). */
export async function deleteReportView(projectId: string, id: string) {
  return attempt(async () => {
    const { user, project, role } = await requireProjectAction(projectId, "run:execute");
    const view = await db.savedReport.findFirst({ where: { id, projectId } });
    if (!view) throw new UserError("That view was already deleted.");
    if (view.createdById !== user.id && !(view.shared && role === "ADMIN")) throw new UserError("Only the person who saved this view, or an admin, can delete it.");
    await db.savedReport.delete({ where: { id } });
    revalidatePath(`/p/${project.key}/reports`);
    return {};
  });
}
