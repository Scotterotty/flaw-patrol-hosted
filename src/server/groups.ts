"use server";

import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { canManageGroups, groupableProjectIds } from "@/lib/groups";
import { requireProjectAction, requireUser } from "@/lib/session";
import { syncUmbrellaMembers } from "@/lib/umbrella";
import { attempt, UserError } from "./result";

// Project groups are shared by the whole team. Admins and leads make, rename and
// delete them; a lead can only move projects they lead. Deleting a group only
// ungroups its projects.

const groupSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name").max(60),
  description: z.string().trim().max(500).default(""),
  projectIds: z.array(z.string().max(40)).max(500).default([]),
});

async function requireManager() {
  const user = await requireUser();
  if (!(await canManageGroups(user))) throw new UserError("Viewers can't change groups.");
  return user;
}

async function nameFree(name: string, except?: string) {
  const clash = await db.projectGroup.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(except ? { id: { not: except } } : {}) } });
  if (clash) throw new UserError(`There's already a group called ${clash.name}.`);
}

function refresh(groupId?: string) {
  revalidatePath("/");
  if (groupId) revalidatePath(`/g/${groupId}`);
}

/** Rename a group and set which of the projects you lead are in it. Projects you can't move stay as they are. */
export async function updateGroup(groupId: string, input: z.input<typeof groupSchema>) {
  return attempt(async () => {
    const user = await requireManager();
    const data = groupSchema.parse(input);
    await db.projectGroup.findUniqueOrThrow({ where: { id: groupId } });
    await nameFree(data.name, groupId);
    const current = await db.project.findMany({ where: { groupId }, select: { id: true } });
    const leaving = await groupableProjectIds(
      user,
      current.map((p) => p.id).filter((id) => !data.projectIds.includes(id)),
    );
    const joining = await groupableProjectIds(user, data.projectIds);
    await db.$transaction([
      db.projectGroup.update({ where: { id: groupId }, data: { name: data.name, description: data.description } }),
      db.project.updateMany({ where: { id: { in: leaving } }, data: { groupId: null } }),
      db.project.updateMany({ where: { id: { in: joining } }, data: { groupId } }),
      // Leaving an umbrella: its team stays on the project, now as ordinary members.
      db.projectMember.updateMany({ where: { projectId: { in: leaving } }, data: { fromUmbrella: false } }),
    ]);
    await syncUmbrellaMembers(groupId);
    refresh(groupId);
    return {};
  });
}

export async function deleteGroup(groupId: string) {
  return attempt(async () => {
    const user = await requireManager();
    const gone = await db.projectGroup.delete({ where: { id: groupId } });
    await logActivity({ actor: user, kind: "delete", action: `Deleted project group ${gone.name}` });
    refresh();
    return {};
  });
}

/** Put one project in an existing group or umbrella, or take it out with null. New groups aren't made anymore; umbrellas took over. */
export async function setProjectGroup(projectId: string, groupId: string | null) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "project:group");
    const target = groupId;
    if (target) {
      const group = await db.projectGroup.findUniqueOrThrow({ where: { id: target } });
      if (group.archivedAt) throw new UserError(`${group.name} is archived. Restore it before moving test cycles in.`);
    }
    if (await db.projectGroup.findUnique({ where: { hubProjectId: projectId } })) throw new UserError("This is an umbrella's hub; it can't move to a group.");
    await db.project.update({ where: { id: projectId }, data: { groupId: target, archivedWithUmbrella: false } });
    if (project.groupId !== target) await db.projectMember.updateMany({ where: { projectId }, data: { fromUmbrella: false } });
    if (target) await syncUmbrellaMembers(target);
    refresh(target ?? project.groupId ?? undefined);
    if (project.groupId && project.groupId !== target) revalidatePath(`/g/${project.groupId}`);
    return { groupId: target };
  });
}

/** Star or unstar a group card for yourself. */
/** Hide umbrellas from your own Umbrellas page, or show them again (ver_94). Only you are affected. */
export async function setGroupsHidden(groupIds: string[], hidden: boolean) {
  return attempt(async () => {
    const user = await requireUser();
    const ids = z.array(z.string().max(40)).max(200).parse(groupIds);
    for (const groupId of ids)
      await db.groupPin.upsert({
        where: { userId_groupId: { userId: user.id, groupId } },
        create: { userId: user.id, groupId, hidden },
        update: { hidden },
      });
    revalidatePath("/");
    return {};
  });
}

export async function setGroupStarred(groupId: string, starred: boolean) {
  return attempt(async () => {
    const user = await requireUser();
    await db.groupPin.upsert({
      where: { userId_groupId: { userId: user.id, groupId } },
      create: { userId: user.id, groupId, starred },
      update: { starred },
    });
    revalidatePath("/");
    return {};
  });
}
