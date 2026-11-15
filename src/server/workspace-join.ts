"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/permissions";
import { NOT_PRACTICE } from "@/lib/practice";
import { requireUser } from "@/lib/session";
import { syncUmbrellaMembers } from "@/lib/umbrella";
import { requireWorkspaceAdmin } from "./admin-guard";
import { attempt, UserError } from "./result";

// No umbrella yet (ver_259): the welcome page's Join your team. Someone signed in who isn't on
// any umbrella asks the workspace admins to add them. Admins see a red dot on their name and the
// request at the top of Workspace settings, where they pick the umbrella and role and press Add.

const nameOf = (u: { name: string | null; email: string }) => u.name || u.email;

/** Ask to be added. Asking again does nothing new. */
export async function askToBeAdded() {
  return attempt(async () => {
    const user = await requireUser();
    const onTeam = await db.projectMember.count({ where: { userId: user.id, project: NOT_PRACTICE } });
    if (onTeam) return { added: true };
    const had = await db.workspaceJoinRequest.findUnique({ where: { userId: user.id } });
    if (!had) {
      await db.workspaceJoinRequest.create({ data: { userId: user.id } });
      await logActivity({ actor: user, kind: "people", action: `${nameOf(user)} asked to be added`, detail: "From the welcome page" });
    }
    revalidatePath("/", "layout");
    return { added: false };
  });
}

/** Take back your own request. */
export async function cancelAskToBeAdded() {
  return attempt(async () => {
    const user = await requireUser();
    await db.workspaceJoinRequest.deleteMany({ where: { userId: user.id } });
    revalidatePath("/", "layout");
    return {};
  });
}

const answerSchema = z.object({
  add: z.boolean(),
  groupId: z.string().max(100).optional(),
  role: z.enum(["ADMIN", "LEAD", "TESTER", "VIEWER"]).default("TESTER"),
});

/** A workspace admin's Add (to an umbrella, with a role) or Ignore. */
export async function answerAskToBeAdded(requestId: string, input: z.input<typeof answerSchema>) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const { add, groupId, role } = answerSchema.parse(input);
    const req = await db.workspaceJoinRequest.findUnique({ where: { id: z.string().max(100).parse(requestId) }, include: { user: { select: { id: true, name: true, email: true } } } });
    if (!req) throw new UserError("That request was already answered or taken back.");
    if (add) {
      if (!groupId) throw new UserError("Pick the umbrella to add them to.");
      const group = await db.projectGroup.findUnique({ where: { id: groupId }, select: { id: true, name: true, hubProjectId: true, hub: { select: { archivedAt: true } } } });
      if (!group?.hubProjectId || group.hub?.archivedAt) throw new UserError("That umbrella isn't there any more. Pick another one.");
      await db.projectMember.upsert({
        where: { projectId_userId: { projectId: group.hubProjectId, userId: req.userId } },
        create: { projectId: group.hubProjectId, userId: req.userId, role },
        update: { role, fromUmbrella: false },
      });
      await syncUmbrellaMembers(group.id);
      // A request to the same team from a shared link is answered too.
      await db.joinRequest.deleteMany({ where: { userId: req.userId, projectId: group.hubProjectId } });
      await db.workspaceJoinRequest.delete({ where: { id: req.id } });
      await logActivity({ actor: admin, kind: "people", action: `Added ${nameOf(req.user)} as ${ROLE_LABEL[role]}`, group: { id: group.id, name: group.name }, detail: "From Ask to be added" });
    } else {
      await db.workspaceJoinRequest.delete({ where: { id: req.id } });
      await logActivity({ actor: admin, kind: "people", action: `Ignored ${nameOf(req.user)}'s request to be added` });
    }
    revalidatePath("/", "layout");
    return {};
  });
}

/**
 * The New umbrella box checks the name as you type, so nobody makes a second "Unity". It only
 * answers for the exact name typed (the Make button refuses it anyway), never lists umbrellas.
 */
export async function umbrellaNameCheck(name: string) {
  return attempt(async () => {
    const user = await requireUser();
    const n = z.string().trim().max(100).parse(name);
    if (n.length < 2) return { clash: null };
    const g = await db.projectGroup.findFirst({ where: { name: { equals: n, mode: "insensitive" } }, select: { id: true, name: true, hubProjectId: true } });
    if (!g) return { clash: null };
    const member =
      user.isAdmin || (!!g.hubProjectId && !!(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: g.hubProjectId, userId: user.id } }, select: { role: true } })));
    const asked = !member && !!g.hubProjectId && !!(await db.joinRequest.findUnique({ where: { projectId_userId: { projectId: g.hubProjectId, userId: user.id } }, select: { id: true } }));
    return { clash: { id: g.id, name: g.name, umbrella: !!g.hubProjectId, member, asked } };
  });
}
