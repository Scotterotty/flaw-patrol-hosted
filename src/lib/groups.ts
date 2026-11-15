import "server-only";
import { db } from "./db";
import { NOT_PRACTICE } from "@/lib/practice";

type Viewer = { id: string; isAdmin: boolean };

/** Admins, and anyone who is a member (not a Viewer) of at least one project, may make and change project groups. */
export async function canManageGroups(user: Viewer) {
  if (user.isAdmin) return true;
  // A practice run (ver_217) makes you a Member of your own sample project only: it doesn't count.
  return (await db.projectMember.count({ where: { userId: user.id, role: { in: ["ADMIN", "LEAD", "TESTER"] }, project: NOT_PRACTICE } })) > 0;
}

/**
 * Who may make a new umbrella: Admins and Leads (Scott, ver_187: a new Member's biggest
 * button shouldn't make something they don't need). Someone on no team yet can, and
 * becomes the new umbrella's Admin.
 */
export async function canMakeUmbrellas(user: Viewer) {
  if (user.isAdmin) return true;
  const roles = await db.projectMember.findMany({ where: { userId: user.id, project: NOT_PRACTICE }, select: { role: true }, distinct: ["role"] });
  return !roles.length || roles.some((r) => r.role === "ADMIN" || r.role === "LEAD");
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
