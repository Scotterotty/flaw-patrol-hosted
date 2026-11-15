import "server-only";
import { headers } from "next/headers";
import { db } from "./db";
import { phaseOf } from "./bash";
import { linkTarget, type LinkTarget } from "./link-access";

// Shared links for people outside the team: who a link's team is, who its admins
// are, and whether someone signed in may come into a bug bash as a guest.

/** The page being opened, set by src/middleware.ts. Null outside a page request. */
export async function currentPath() {
  try {
    return (await headers()).get("x-fp-path");
  } catch {
    return null;
  }
}

type ProjectRow = { id: string; key: string; name: string; groupId: string | null; keepMembersSeparate: boolean };

/**
 * The team a project's people belong to: its umbrella's hub (unless the test cycle keeps
 * its members separate), else the project itself. Join requests and Add go there.
 */
export async function teamOf(project: ProjectRow) {
  const asHub = await db.projectGroup.findUnique({ where: { hubProjectId: project.id }, select: { id: true, name: true } });
  if (asHub) return { id: project.id, key: project.key, name: asHub.name, groupId: asHub.id };
  if (project.groupId && !project.keepMembersSeparate) {
    const g = await db.projectGroup.findUnique({ where: { id: project.groupId }, select: { id: true, name: true, hub: { select: { id: true, key: true } } } });
    if (g?.hub) return { id: g.hub.id, key: g.hub.key, name: g.name, groupId: g.id };
  }
  return { id: project.id, key: project.key, name: project.name, groupId: null as string | null };
}
export type Team = Awaited<ReturnType<typeof teamOf>>;

/** Where the team's Members list is. */
export const membersHref = (team: Team) => (team.groupId ? `/g/${team.groupId}/settings#members` : `/p/${team.key}/settings#members`);

const nameOf = (u: { name: string | null; email: string }) => u.name ?? u.email;

/** The team's admins by name; workspace admins when the team has none. */
export async function adminsOf(teamId: string) {
  const rows = await db.projectMember.findMany({ where: { projectId: teamId, role: "ADMIN" }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } });
  const people = rows.length ? rows.map((r) => r.user) : await db.user.findMany({ where: { isAdmin: true }, select: { id: true, name: true, email: true }, orderBy: { createdAt: "asc" } });
  return people.map(nameOf);
}

/** Whether this person is on the project (workspace admins are everywhere). */
async function onProject(projectId: string, user: { id: string; isAdmin: boolean }) {
  if (user.isAdmin) return true;
  return !!(await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } }, select: { role: true } }));
}

/**
 * A bug bash someone outside the team may be in: anyone signed in while it's scheduled or
 * live, and people who took part after it ends. Null when they may not.
 */
export async function bashGuestOk(bashId: string, userId: string) {
  const bash = await db.bugBash.findUnique({ where: { id: bashId }, select: { id: true, projectId: true, startsAt: true, endsAt: true, endedAt: true, wrappedAt: true, run: { select: { projectId: true } } } });
  if (!bash?.run) return null;
  const phase = phaseOf(bash);
  const joined = !!(await db.bashPerson.findUnique({ where: { bashId_userId: { bashId, userId } }, select: { userId: true } }));
  if (phase === "scheduled" || phase === "live" || joined) return { ...bash, runProjectId: bash.run.projectId, phase, joined };
  return null;
}

/**
 * Everything the "You're not on this team yet" page needs about a link. Null when the link
 * doesn't point at anything real, so the page can still say Not found.
 */
export async function resolveLink(path: string, user: { id: string; isAdmin: boolean }) {
  const target: LinkTarget | null = linkTarget(path);
  if (!target) return null;
  let project: ProjectRow | null = null;
  if (target.kind === "project") project = await db.project.findUnique({ where: { key: target.key }, select: { id: true, key: true, name: true, groupId: true, keepMembersSeparate: true } });
  else {
    const g = await db.projectGroup.findUnique({ where: { id: target.groupId }, select: { hub: { select: { id: true, key: true, name: true, groupId: true, keepMembersSeparate: true } } } });
    project = g?.hub ?? null;
  }
  if (!project) return null;
  const team = await teamOf(project);
  const [member, admins, request, bash] = await Promise.all([
    onProject(project.id, user),
    adminsOf(team.id),
    db.joinRequest.findUnique({ where: { projectId_userId: { projectId: team.id, userId: user.id } } }),
    target.kind === "project" && target.bashId ? db.bugBash.findUnique({ where: { id: target.bashId }, select: { id: true, projectId: true } }) : null,
  ]);
  return { target, project, team, member, admins, request, bash: bash && bash.projectId === project.id ? bash : null };
}

/** Requests waiting on a team, for the top of its Members list. */
export async function joinRequestRows(teamId: string) {
  const rows = await db.joinRequest.findMany({ where: { projectId: teamId }, include: { user: { select: { id: true, name: true, email: true, avatarAt: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, userId: r.userId, name: r.user.name, email: r.user.email, avatarAt: r.user.avatarAt, what: r.what, at: r.createdAt.toISOString() }));
}

/**
 * Requests this person can answer, for the dot on their avatar: on teams where they're an
 * admin, or anywhere for a workspace admin. With where the first one is answered.
 */
export async function joinRequestsFor(user: { id: string; isAdmin: boolean }) {
  const where = user.isAdmin ? {} : { project: { members: { some: { userId: user.id, role: "ADMIN" as const } } } };
  const [count, first, waiting] = await Promise.all([
    db.joinRequest.count({ where }),
    db.joinRequest.findFirst({ where, orderBy: { createdAt: "asc" }, select: { project: { select: { id: true, key: true, name: true, groupId: true, keepMembersSeparate: true } } } }),
    // Ask to be added from the welcome page (ver_258): workspace admins answer it in Workspace settings.
    user.isAdmin ? db.workspaceJoinRequest.count() : 0,
  ]);
  return { count, href: first ? membersHref(await teamOf(first.project)) : null, waiting };
}
