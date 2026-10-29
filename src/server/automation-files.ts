"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { MAX_MB } from "@/lib/automation-files";
import { deleteMedia, deletePreview, groupProjectIds } from "@/lib/automation-storage";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

// Screenshots, videos and replays (ver_93): umbrella Settings → Automation decides what's
// kept, and old files go only when someone deletes them, with a preview first.

async function requireGroup(groupId: string) {
  const group = await db.projectGroup.findUnique({ where: { id: groupId }, select: { id: true, name: true, hubProjectId: true } });
  if (!group?.hubProjectId) throw new UserError("This isn't an umbrella.");
  const { user } = await requireProjectAction(group.hubProjectId, "run:manage");
  return { group, user };
}

const settingsSchema = z.object({ keep: z.enum(["failed", "all"]), maxMb: z.number().refine((n) => (MAX_MB as readonly number[]).includes(n), "Pick 25, 50 or 100 MB.") });

export async function saveFileSettings(groupId: string, input: z.input<typeof settingsSchema>) {
  return attempt(async () => {
    const { group, user } = await requireGroup(groupId);
    const data = settingsSchema.parse(input);
    await db.projectGroup.update({ where: { id: group.id }, data: { automationFiles: data as Prisma.InputJsonValue } });
    await logActivity({ actor: user, kind: "settings", action: "Changed which screenshots, videos and replays are kept", group: { id: group.id, name: group.name } });
    revalidatePath(`/g/${groupId}`, "layout");
    return {};
  });
}

const dayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new UserError("Pick a date.");
  return d;
};

/** Delete files from runs older than…: how much it frees, before anything goes. */
export async function previewDeleteOlder(groupId: string, before: string) {
  return attempt(async () => {
    const { group } = await requireGroup(groupId);
    return deletePreview({ projectId: { in: await groupProjectIds(group.id) }, createdAt: { lt: dayOf(before) } });
  });
}

export async function deleteOlderFiles(groupId: string, before: string) {
  return attempt(async () => {
    const { group, user } = await requireGroup(groupId);
    const res = await deleteMedia({ projectId: { in: await groupProjectIds(group.id) }, createdAt: { lt: dayOf(before) } }, user.name ?? user.email);
    await logActivity({ actor: user, kind: "settings", action: `Deleted ${res.files} screenshots, videos and replays from runs before ${before}`, group: { id: group.id, name: group.name } });
    revalidatePath(`/g/${groupId}`, "layout");
    return res;
  });
}

async function requireRun(runId: string) {
  const run = await db.testRun.findUnique({ where: { id: runId }, select: { id: true, number: true, projectId: true, project: { select: { key: true, name: true, groupId: true } } } });
  if (!run) throw new UserError("That run isn't here anymore.");
  const { user } = await requireProjectAction(run.projectId, "run:delete");
  return { run, user };
}

/** A run's ⋯ → Delete files: what goes and what stays on bugs. */
export async function previewDeleteRunFiles(runId: string) {
  return attempt(async () => {
    const { run } = await requireRun(runId);
    return deletePreview({ id: run.id });
  });
}

export async function deleteRunFiles(runId: string) {
  return attempt(async () => {
    const { run, user } = await requireRun(runId);
    const res = await deleteMedia({ id: run.id }, user.name ?? user.email);
    await logActivity({ actor: user, kind: "run", action: `Deleted ${res.files} screenshots, videos and replays from run R${run.number}`, project: { id: run.projectId, name: run.project.name, groupId: run.project.groupId } });
    revalidatePath(`/p/${run.project.key}/runs/${run.number}`);
    return res;
  });
}
