"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { emailInvite, mailOn, newLink, placeName } from "@/lib/invites";
import { inviteMessage } from "@/lib/invite-message";
import { ROLE_LABEL } from "@/lib/permissions";
import { requireProjectAction, requireUser } from "@/lib/session";
import { syncUmbrellaMembers } from "@/lib/umbrella";
import { BUILD } from "@/lib/whats-new";
import { attempt, UserError } from "./result";

const projectSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Use 2 to 10 letters or digits, starting with a letter"),
  name: z.string().trim().min(1, "Required").max(100),
  description: z.string().trim().max(2000).default(""),
});

export async function updateProject(projectId: string, input: { name: string; description: string }) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "project:manage");
    const data = projectSchema.pick({ name: true, description: true }).parse(input);
    await db.project.update({ where: { id: projectId }, data });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

const roleSchema = z.enum(["ADMIN", "LEAD", "TESTER", "VIEWER"]);

export async function addMember(projectId: string, input: { email: string; role: string; sendInvite?: boolean }) {
  return attempt(async () => {
    const { project, user: admin } = await requireProjectAction(projectId, "members:manage");
    const email = z.string().trim().toLowerCase().email("Enter a valid email").parse(input.email);
    const role = roleSchema.parse(input.role);
    // Creating the user row is the invitation: they can now sign in with that email.
    // New people start with this version's What's new marked seen.
    const user = await db.user.upsert({ where: { email }, create: { email, whatsNewSeen: BUILD }, update: {} });
    const before = await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } }, select: { role: true } });
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: user.id } },
      create: { projectId, userId: user.id, role },
      // Added here by hand: no longer just following the umbrella's team.
      update: { role, fromUmbrella: false },
    });
    await syncIfHub(projectId);
    // Email them when Workspace settings → Email is set up and the box was ticked (ver_92).
    // If sending fails they are still added; the form offers Copy invite link instead.
    let emailed = false;
    let emailError: string | null = null;
    if (input.sendInvite && (await mailOn())) {
      try {
        await emailInvite({ projectId, user, role, by: admin });
        emailed = true;
      } catch (e) {
        emailError = (e as Error).message;
      }
    }
    await logActivity({
      actor: admin,
      kind: "people",
      action: before ? `Changed ${email}'s role from ${ROLE_LABEL[before.role]} to ${ROLE_LABEL[role]}` : `Added ${user.name ?? email} as ${ROLE_LABEL[role]}`,
      project,
      detail: emailed ? "Invite emailed" : emailError ? "Invite email failed" : "",
    });
    // Not emailed (email off, unticked, or it failed): someone new gets their one-time invite link
    // in the message to copy (ver_114). The sign-in page alone can't let them in.
    let inviteUrl: string | null = null;
    let message: string | null = null;
    if (!emailed && !user.lastLoginAt && !user.passwordSetAt) {
      const link = await newLink(user.id, "invite", admin.id);
      inviteUrl = link.url;
      message = inviteMessage(await placeName(projectId), link.url);
    }
    revalidatePath(`/p/${project.key}/settings`);
    revalidatePath("/g/[id]/settings", "page");
    // Someone who already uses Flaw Patrol just signs in as usual.
    return { email, role, hasPassword: !!user.passwordSetAt, userId: user.id, emailed, emailError, inviteUrl, message };
  });
}

async function assertAnotherAdmin(projectId: string, userId: string) {
  const admins = await db.projectMember.count({ where: { projectId, role: "ADMIN", userId: { not: userId } } });
  if (admins > 0) return;
  // Name the umbrella when this is its team (ver_91), so the message says where the team lives.
  const group = await db.projectGroup.findUnique({ where: { hubProjectId: projectId }, select: { name: true } });
  throw new UserError(group ? `${group.name} needs at least one admin.` : "A test cycle needs at least one admin.");
}

export async function changeRole(projectId: string, userId: string, role: string) {
  return attempt(async () => {
    const { project, user: admin } = await requireProjectAction(projectId, "members:manage");
    const newRole = roleSchema.parse(role);
    if (newRole !== "ADMIN") await assertAnotherAdmin(projectId, userId);
    const before = await db.projectMember.update({ where: { projectId_userId: { projectId, userId } }, data: { role: newRole, fromUmbrella: false }, include: { user: { select: { name: true, email: true } } } });
    await logActivity({ actor: admin, kind: "people", action: `Changed ${before.user.name ?? before.user.email}'s role to ${ROLE_LABEL[newRole]}`, project });
    await syncIfHub(projectId);
    revalidatePath(`/p/${project.key}/settings`);
    revalidatePath("/g/[id]/settings", "page");
    return {};
  });
}

export async function removeMember(projectId: string, userId: string) {
  return attempt(async () => {
    const { project, user: admin } = await requireProjectAction(projectId, "members:manage");
    await assertAnotherAdmin(projectId, userId);
    const gone = await db.projectMember.delete({ where: { projectId_userId: { projectId, userId } }, include: { user: { select: { name: true, email: true } } } });
    await logActivity({ actor: admin, kind: "people", action: `Removed ${gone.user.name ?? gone.user.email}`, project, detail: `Was ${ROLE_LABEL[gone.role]}` });
    await syncIfHub(projectId);
    revalidatePath(`/p/${project.key}/settings`);
    revalidatePath("/g/[id]/settings", "page");
    return {};
  });
}

/** When an umbrella's team changes, its projects follow. */
async function syncIfHub(projectId: string) {
  const group = await db.projectGroup.findUnique({ where: { hubProjectId: projectId }, select: { id: true } });
  if (group) {
    await syncUmbrellaMembers(group.id);
    revalidatePath("/", "layout");
  }
}

async function requireVisible(projectId: string) {
  const user = await requireUser();
  const visible = user.isAdmin || (await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } }));
  if (!visible) throw new UserError("You're not in that test cycle.");
  return user;
}

/** Star or unstar a project for yourself; starred projects stay at the top of the Projects page. */
export async function setStarred(projectId: string, starred: boolean) {
  return attempt(async () => {
    const user = await requireVisible(projectId);
    await db.projectPin.upsert({
      where: { userId_projectId: { userId: user.id, projectId } },
      create: { userId: user.id, projectId, starred },
      update: { starred },
    });
    revalidatePath("/");
    return {};
  });
}

/** Hide a project from your own Projects page (it moves to "Hidden by you"), or show it again. */
export async function setHidden(projectId: string, hidden: boolean) {
  return attempt(async () => {
    const user = await requireVisible(projectId);
    await db.projectPin.upsert({
      where: { userId_projectId: { userId: user.id, projectId } },
      create: { userId: user.id, projectId, hidden },
      update: { hidden },
    });
    revalidatePath("/");
    return {};
  });
}

/**
 * Your own order for one section of the Projects page, top first. Group cards
 * come in as "g:<group id>". An empty list puts everything back in name order.
 */
export async function setProjectOrder(projectIds: string[]) {
  return attempt(async () => {
    const user = await requireUser();
    const ids = z.array(z.string().max(44)).max(500).parse(projectIds);
    if (ids.length === 0) {
      await db.projectPin.updateMany({ where: { userId: user.id }, data: { position: null } });
      // Umbrella cards keep their own order; this resets the cards below them.
      await db.groupPin.updateMany({ where: { userId: user.id, group: { hubProjectId: null } }, data: { position: null } });
    } else {
      const projectIdsOnly = ids.filter((id) => !id.startsWith("g:"));
      const groupIds = ids.filter((id) => id.startsWith("g:")).map((id) => id.slice(2));
      const allowed = await db.project.findMany({
        where: { id: { in: projectIdsOnly }, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) },
        select: { id: true },
      });
      const groups = await db.projectGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true } });
      const ok = new Set([...allowed.map((p) => p.id), ...groups.map((g) => `g:${g.id}`)]);
      await db.$transaction(
        ids
          .filter((id) => ok.has(id))
          .map((id, position) =>
            id.startsWith("g:")
              ? db.groupPin.upsert({
                  where: { userId_groupId: { userId: user.id, groupId: id.slice(2) } },
                  create: { userId: user.id, groupId: id.slice(2), position },
                  update: { position },
                })
              : db.projectPin.upsert({
                  where: { userId_projectId: { userId: user.id, projectId: id } },
                  create: { userId: user.id, projectId: id, position },
                  update: { position },
                }),
          ),
      );
    }
    revalidatePath("/");
    return {};
  });
}

/**
 * Delete a project and everything in it: cases, suites, runs, results and attachments.
 * Project admins only, and they must type the project key, since it can't be undone.
 */
export async function deleteProject(projectId: string, typedKey: string) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "cycle:archive");
    if (typedKey.trim().toUpperCase() !== project.key) throw new UserError(`Type ${project.key} to confirm.`);
    const hubOf = await db.projectGroup.findUnique({ where: { hubProjectId: projectId } });
    if (hubOf) throw new UserError(`This holds the ${hubOf.name} case library, which every ${hubOf.name} test cycle runs from, so it can't be deleted.`);
    await db.project.delete({ where: { id: projectId } });
    await logActivity({ actor: user, kind: "delete", action: `Deleted test cycle ${project.name}`, detail: project.key });
    revalidatePath("/");
    return {};
  });
}

/** Archive a project (it moves to the collapsed Archived section) or bring it back. Nothing is deleted. */
/** Archive several test cycles at once (the Archive… card's tick list). Each needs its own admin rights. */
export async function archiveProjects(projectIds: string[]) {
  return attempt(async () => {
    const ids = z.array(z.string().max(44)).min(1, "Tick at least one test cycle.").max(200).parse(projectIds);
    const keys: string[] = [];
    const access = [];
    for (const id of ids) access.push(await requireProjectAction(id, "cycle:archive"));
    for (const a of access) keys.push(a.project.key);
    await db.project.updateMany({ where: { id: { in: ids }, archivedAt: null }, data: { archivedAt: new Date(), archivedWithUmbrella: false } });
    for (const a of access) await logActivity({ actor: a.user, kind: "delete", action: `Archived test cycle ${a.project.name}`, project: a.project });
    revalidatePath("/");
    for (const key of keys) revalidatePath(`/p/${key}`, "layout");
    revalidatePath("/g", "layout");
    return { count: ids.length };
  });
}

export async function setArchived(projectId: string, archived: boolean) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "cycle:archive");
    const group = !archived && project.groupId ? await db.projectGroup.findUnique({ where: { id: project.groupId }, select: { name: true, archivedAt: true } }) : null;
    if (group?.archivedAt) throw new UserError(`${group.name} is archived. Restore ${group.name} to bring this test cycle back.`);
    await db.project.update({ where: { id: projectId }, data: { archivedAt: archived ? new Date() : null, archivedWithUmbrella: false } });
    await logActivity({ actor: user, kind: "delete", action: `${archived ? "Archived" : "Restored"} test cycle ${project.name}`, project });
    revalidatePath("/");
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
