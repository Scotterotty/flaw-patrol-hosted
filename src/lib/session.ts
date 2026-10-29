import "server-only";
import type { Role } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "./db";
import { can, parseRoleRules, type Action, type RoleRules, type Who } from "./permissions";
import { spellingFor, type Spelling } from "./spelling";

export class Forbidden extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
  }
}

export const currentUser = cache(async () => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return db.user.findUnique({ where: { id } });
});

/** How the signed-in person reads the app: their own pick, else US English. */
export const mySpelling = cache(async (): Promise<Spelling> => spellingFor((await currentUser())?.spelling));

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}

/** Load a project by key with the viewer's role; 404 when they can't see it. */
export const projectAccess = cache(async (key: string) => {
  const user = await requireUser();
  const project = await db.project.findUnique({
    where: { key: key.toUpperCase() },
    include: { members: { where: { userId: user.id } } },
  });
  if (!project) notFound();
  const memberRole = project.members[0]?.role ?? null;
  const role: Role | null = user.isAdmin ? "ADMIN" : memberRole;
  if (!role) notFound();
  const who: Who = { role, rules: await roleRulesFor(project) };
  return { user, project, role, who };
});

/**
 * The Roles card rules that apply in a project: its umbrella's (for the hub and every
 * test cycle in it), else its own when it isn't in an umbrella.
 */
export const roleRulesFor = cache(async (project: { id: string; groupId: string | null; roleRules?: unknown }): Promise<RoleRules | null> => {
  const group = await db.projectGroup.findFirst({
    where: { OR: [{ hubProjectId: project.id }, ...(project.groupId ? [{ id: project.groupId, hubProjectId: { not: null } }] : [])] },
    select: { roleRules: true },
  });
  if (group) return parseRoleRules(group.roleRules);
  const own = project.roleRules !== undefined ? project.roleRules : (await db.project.findUnique({ where: { id: project.id }, select: { roleRules: true } }))?.roleRules;
  return parseRoleRules(own);
});

/** For server actions: like projectAccess but throws Forbidden when the role is too low. */
export async function requireProjectAction(projectId: string, action: Action) {
  const user = await requireUser();
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  const role: Role | null = user.isAdmin ? "ADMIN" : (member?.role ?? null);
  if (!role) throw new Forbidden();
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const who: Who = { role, rules: await roleRulesFor(project) };
  if (!can(who, action)) throw new Forbidden();
  return { user, project, role, who };
}
