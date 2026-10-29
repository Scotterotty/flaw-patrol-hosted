"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { regressionSettingsSchema } from "@/lib/regression";
import { requireProjectAction, requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";

/**
 * Turn the Regression flag off (or back on) for one case in one run (ver_93). Anyone on the
 * test cycle can, because it's for when the flag is plainly wrong; their name is kept with it.
 */
export async function setRegressionOff(projectId: string, entryId: string, off: boolean) {
  return attempt(async () => {
    const user = await requireUser();
    const entry = await db.runEntry.findFirst({ where: { id: entryId, run: { projectId } }, select: { id: true, run: { select: { number: true, project: { select: { key: true, members: { where: { userId: user.id }, select: { userId: true } } } } } } } });
    if (!entry || (!user.isAdmin && !entry.run.project.members.length)) throw new UserError("That case isn't in this run anymore.");
    await db.runEntry.update({ where: { id: entryId }, data: { regressionOff: off, regressionOffBy: off ? (user.name ?? user.email) : "" } });
    revalidatePath(`/p/${entry.run.project.key}/runs/${entry.run.number}`, "layout");
    return {};
  });
}

/** Umbrella Settings → Regression flag: on or off, what it compares with, and the Jira label. Leads and admins. */
export async function saveRegressionSettings(groupId: string, input: unknown) {
  return attempt(async () => {
    const group = await db.projectGroup.findUnique({ where: { id: groupId }, select: { hubProjectId: true } });
    if (!group?.hubProjectId) throw new UserError("This isn't an umbrella.");
    await requireProjectAction(group.hubProjectId, "run:manage");
    const data = regressionSettingsSchema.parse(input);
    await db.projectGroup.update({ where: { id: groupId }, data: { regression: data as Prisma.InputJsonValue } });
    revalidatePath(`/g/${groupId}`, "layout");
    return {};
  });
}
