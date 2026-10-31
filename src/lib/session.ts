import "server-only";
import type { Role } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "./db";
import { can, parseRoleRules, type Action, type RoleRules, type Who } from "./permissions";
import { spellingFor, type Spelling } from "./spelling";
import { bashGuestPath, safeInside } from "./link-access";
import { bashGuestOk, currentPath } from "./link-access-server";

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

/**
 * Someone signed in who isn't on this team (ver_115): send them to the page that says what the
 * link is and offers Ask to join, instead of a bare Not found.
 */
export async function notOnTeam(fallback: string): Promise<never> {
  const path = safeInside(await currentPath()) ?? fallback;
  redirect(`/access?to=${encodeURIComponent(path)}`);
}

/**
 * Load a project by key with the viewer's role. 404 when it doesn't exist. People outside the
 * team get a guest pass for a bug bash link they may join (ver_115); other links send them to
 * Ask to join.
 */
export const projectAccessOrGuest = cache(async (key: string) => {
  const user = await requireUser();
  // The Roles card rules come along in the same query (ver_120), instead of a second trip.
  const row = await db.project.findUnique({
    where: { key: key.toUpperCase() },
    include: { members: { where: { userId: user.id } }, hubOf: { select: { roleRules: true } }, group: { select: { roleRules: true, hubProjectId: true } } },
  });
  if (!row) notFound();
  const { hubOf, group, ...project } = row;
  const memberRole = project.members[0]?.role ?? null;
  const role: Role | null = user.isAdmin ? "ADMIN" : memberRole;
  if (role) {
    // Same rules as roleRulesFor: the umbrella's (hub or test cycle in it), else the project's own.
    const umbrellaRules = hubOf ?? (group?.hubProjectId ? group : null);
    const who: Who = { role, rules: parseRoleRules(umbrellaRules ? umbrellaRules.roleRules : project.roleRules) };
    return { guest: null, user, project, role, who };
  }
  const path = await currentPath();
  const at = path ? bashGuestPath(path) : null;
  const bash = at && at.key === project.key ? await bashGuestOk(at.id, user.id) : null;
  if (!at || !bash || bash.projectId !== project.id) return notOnTeam(`/p/${project.key}`);
  // Guests start on Join, where they pick an area; the report is for people who took part.
  if (!bash.joined && at.page !== "join") redirect(`/p/${project.key}/bashes/${bash.id}/join`);
  // A guest acts like a Viewer inside the bash: join, log, +1 and attach. Nothing else.
  const who: Who = { role: "VIEWER", rules: null };
  return { guest: { bashId: bash.id }, user, project, role: "VIEWER" as Role, who };
});

/** Load a project by key with the viewer's role; 404 when it doesn't exist, Ask to join when they aren't on it. */
export const projectAccess = cache(async (key: string) => {
  const a = await projectAccessOrGuest(key);
  if (a.guest) return notOnTeam(`/p/${a.project.key}`);
  return a;
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
