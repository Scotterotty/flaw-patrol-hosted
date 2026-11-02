import "server-only";
import { db } from "./db";

type Viewer = { id: string; isAdmin: boolean };

/** Admins, and anyone who is a member (not a Viewer) of at least one project, may make and change project groups. */
export async function canManageGroups(user: Viewer) {
  if (user.isAdmin) return true;
  return (await db.projectMember.count({ where: { userId: user.id, role: { in: ["ADMIN", "LEAD", "TESTER"] } } })) > 0;
}

/**
 * Who may make a new umbrella: everyone except Viewers. Someone who is only
 * ever a Viewer can't; someone on no team yet can, and becomes the new umbrella's Admin.
 */
export async function canMakeUmbrellas(user: Viewer) {
  if (user.isAdmin) return true;
  const roles = await db.projectMember.findMany({ where: { userId: user.id }, select: { role: true }, distinct: ["role"] });
  return !roles.length || roles.some((r) => r.role !== "VIEWER");
}

/** The ones among these projects the viewer may move in or out of a group: those where they are more than a Viewer. */
export async function groupableProjectIds(user: Viewer, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.project.findMany({
    where: { id: { in: ids }, ...(user.isAdmin ? {} : { members: { some: { userId: user.id, role: { in: ["ADMIN", "LEAD", "TESTER"] } } } }) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Groups the viewer can see: any group holding one of their projects, plus empty groups for those who manage them. */
export async function visibleGroups(user: Viewer, manager: boolean) {
  const mine = user.isAdmin ? {} : { members: { some: { userId: user.id } } };
  return db.projectGroup.findMany({
    where: manager ? { OR: [{ projects: { some: mine } }, { projects: { none: {} } }] } : { projects: { some: mine } },
    include: { pins: { where: { userId: user.id } } },
    orderBy: { name: "asc" },
  });
}
