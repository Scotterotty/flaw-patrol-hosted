"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { MEMBER_ACCESS, safeInside } from "@/lib/link-access";
import { membersHref, resolveLink, teamOf } from "@/lib/link-access-server";
import { ROLE_LABEL } from "@/lib/permissions";
import { requireProjectAction, requireUser } from "@/lib/session";
import { alertJoinRequest } from "@/lib/slack";
import { syncUmbrellaMembers } from "@/lib/umbrella";
import { attempt, UserError } from "./result";

// Ask to join (ver_115): someone signed in opens a link to a team they aren't on and asks.
// The team's admins see it at the top of Settings → Members (and a dot on their avatar), and
// Slack hears about it when alerts are set up. Add gives them the role picked; Ignore drops it.

const nameOf = (u: { name: string | null; email: string }) => u.name ?? u.email;

/** Ask to join the team a link belongs to. */
export async function askToJoin(path: string) {
  return attempt(async () => {
    const user = await requireUser();
    const to = safeInside(path);
    const link = to ? await resolveLink(to, user) : null;
    if (!link) throw new UserError("That link doesn't open anything in Flaw Patrol.");
    if (link.member) return { member: true };
    const what = link.bash ? "a bug bash" : link.target.what;
    const had = await db.joinRequest.findUnique({ where: { projectId_userId: { projectId: link.team.id, userId: user.id } } });
    if (!had) {
      await db.joinRequest.create({ data: { projectId: link.team.id, userId: user.id, what, path: to! } });
      await logActivity({ actor: user, kind: "people", action: `${nameOf(user)} asked to join`, project: { id: link.team.id, name: link.team.name, groupId: link.team.groupId }, detail: `Opened ${what} link` });
      await alertJoinRequest(link.team.id, { name: nameOf(user), email: user.email, what }, membersHref(link.team));
    }
    revalidatePath("/", "layout");
    return { member: false };
  });
}

/** Take back your own request. */
export async function cancelJoinRequest(requestId: string) {
  return attempt(async () => {
    const user = await requireUser();
    await db.joinRequest.deleteMany({ where: { id: requestId, userId: user.id } });
    revalidatePath("/", "layout");
    return {};
  });
}

const answerSchema = z.object({ add: z.boolean(), role: z.enum(["ADMIN", "LEAD", "TESTER", "VIEWER"]).default("TESTER") });

/** An admin's Add (with a role) or Ignore. */
export async function answerJoinRequest(requestId: string, input: z.input<typeof answerSchema>) {
  return attempt(async () => {
    const req = await db.joinRequest.findUnique({ where: { id: requestId }, include: { user: true, project: { select: { id: true, key: true, name: true, groupId: true, keepMembersSeparate: true } } } });
    if (!req) throw new UserError("That request was already answered or taken back.");
    const { user: admin, project } = await requireProjectAction(req.projectId, "members:manage");
    const { add, role } = answerSchema.parse(input);
    const team = await teamOf(req.project);
    if (add) {
      await db.projectMember.upsert({
        where: { projectId_userId: { projectId: req.projectId, userId: req.userId } },
        create: { projectId: req.projectId, userId: req.userId, role },
        update: { role, fromUmbrella: false },
      });
      const hubOf = await db.projectGroup.findUnique({ where: { hubProjectId: req.projectId }, select: { id: true } });
      if (hubOf) await syncUmbrellaMembers(hubOf.id);
    }
    await db.joinRequest.delete({ where: { id: requestId } });
    await logActivity({
      actor: admin,
      kind: "people",
      action: add ? `Added ${nameOf(req.user)} as ${ROLE_LABEL[role]}` : `Ignored ${nameOf(req.user)}'s request to join`,
      project: { id: project.id, name: team.name, groupId: team.groupId },
      detail: add ? "From Ask to join" : "",
    });
    revalidatePath("/", "layout");
    return {};
  });
}

/**
 * A Viewer asks for Member access (ver_124, persona audit #6). It goes in the same list as
 * Ask to join, so admins answer both in one place: Add with Member (or any role) changes theirs.
 */
export async function askForMemberAccess(projectId: string, path: string) {
  return attempt(async () => {
    const { user, project, role } = await requireProjectAction(projectId, "bash:join");
    if (role !== "VIEWER") return { asked: false };
    const team = await teamOf(project);
    const had = await db.joinRequest.findUnique({ where: { projectId_userId: { projectId: team.id, userId: user.id } } });
    if (!had) {
      await db.joinRequest.create({ data: { projectId: team.id, userId: user.id, what: MEMBER_ACCESS, path: safeInside(path) ?? `/p/${team.key}` } });
      await logActivity({ actor: user, kind: "people", action: `${nameOf(user)} asked for Member access`, project: { id: team.id, name: team.name, groupId: team.groupId }, detail: "From the Viewer note" });
      await alertJoinRequest(team.id, { name: nameOf(user), email: user.email, what: MEMBER_ACCESS }, membersHref(team));
    }
    revalidatePath("/", "layout");
    return { asked: true };
  });
}
