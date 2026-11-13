"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { passwordSignInOn } from "@/auth";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { NOT_PRACTICE } from "@/lib/practice";
import { signInButtons } from "@/lib/sign-in-config";
import { requireWorkspaceAdmin } from "./admin-guard";
import { attempt, UserError } from "./result";

// Workspace settings → Admins: a workspace admin makes another person a workspace admin, or
// takes it away. Failsafes, so nobody is locked out by accident:
// - The last workspace admin can never be removed (checked and changed in one transaction).
// - Before removing, the box says what the person loses: Workspace settings, and every
//   project they could only open as an admin (with a count).
// - With email and password sign-in turned off, only admins may still use a password. Someone
//   who has a password then can't sign in once they stop being an admin, so removing them needs
//   a second, explicit "I understand" (the server refuses without it).

const userId = z.string().min(1).max(100);
const nameOf = (u: { name: string | null; email: string }) => u.name || u.email;

/** People who could become admins, matching a name or email: searched in the database, so nobody is out of reach. */
export async function searchPeopleForAdmin(query: string) {
  return attempt(async () => {
    await requireWorkspaceAdmin();
    const q = query.trim().slice(0, 100);
    if (q.length < 2) return { people: [] };
    const rows = await db.user.findMany({
      where: { isAdmin: false, OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
      take: 8,
    });
    return { people: rows.map((u) => ({ id: u.id, name: nameOf(u), email: u.email })) };
  });
}

/** Make someone who already has an account a workspace admin. */
export async function makeWorkspaceAdmin(id: string) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const target = await db.user.findUnique({ where: { id: userId.parse(id) }, select: { id: true, name: true, email: true, isAdmin: true } });
    if (!target) throw new UserError("That person doesn't have a Flaw Patrol account yet. Invite them to a project first.");
    if (target.isAdmin) return { name: nameOf(target) };
    await db.user.update({ where: { id: target.id }, data: { isAdmin: true } });
    await logActivity({ actor: admin, kind: "people", action: `Made ${nameOf(target)} a workspace admin`, detail: target.email });
    revalidatePath("/workspace");
    return { name: nameOf(target) };
  });
}

export type RemovalCheck = {
  name: string;
  self: boolean;
  /** They're the only admin: removing is refused. */
  lastAdmin: boolean;
  /** Projects (not archived) they can only open because they're an admin. */
  projectsLost: number;
  /** Password sign-in is off and they have a password: they may not be able to sign in afterwards. */
  signInRisk: boolean;
  /** The company sign-ins that are on, for the warning ("Microsoft or Google"). */
  signInWith: string[];
};

async function removalFacts(target: { id: string; name: string | null; email: string }, adminId: string): Promise<RemovalCheck> {
  const [admins, projectsLost, passwordOn, withPassword, buttons] = await Promise.all([
    db.user.count({ where: { isAdmin: true } }),
    db.project.count({ where: { archivedAt: null, ...NOT_PRACTICE, members: { none: { userId: target.id } } } }),
    passwordSignInOn(),
    db.user.count({ where: { id: target.id, passwordHash: { not: null } } }),
    signInButtons(),
  ]);
  return {
    name: nameOf(target),
    self: target.id === adminId,
    lastAdmin: admins <= 1,
    projectsLost,
    signInRisk: !passwordOn && withPassword > 0,
    signInWith: buttons.map((b) => b.name),
  };
}

/** What removing this admin would do, for the confirm box. Nothing changes. */
export async function checkAdminRemoval(id: string) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const target = await db.user.findUnique({ where: { id: userId.parse(id) }, select: { id: true, name: true, email: true, isAdmin: true } });
    if (!target?.isAdmin) throw new UserError("They're not a workspace admin anymore. Reload the page.");
    return { check: await removalFacts(target, admin.id) };
  });
}

/** Postgres may stop one of two removals that run at the same moment; try again a couple of times. */
async function serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let i = 0; ; i++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      if (i < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") continue;
      throw e;
    }
  }
}

/** Take workspace admin away. They keep their project roles. Refuses for the last admin, and asks twice when they could be locked out. */
export async function removeWorkspaceAdmin(id: string, opts: { understoodSignIn?: boolean } = {}) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const target = await db.user.findUnique({ where: { id: userId.parse(id) }, select: { id: true, name: true, email: true, isAdmin: true } });
    if (!target?.isAdmin) return { self: target?.id === admin.id };
    const facts = await removalFacts(target, admin.id);
    if (facts.signInRisk && !facts.signInWith.length) {
      throw new UserError(
        `Password sign-in is only on for admins and no company sign-in is turned on, so ${facts.self ? "you" : facts.name} couldn't sign in at all. Turn on password sign-in or a company sign-in first (Sign-in, above).`,
      );
    }
    if (facts.signInRisk && !opts.understoodSignIn) {
      throw new UserError(
        `${facts.self ? "You sign" : `${facts.name} signs`} in with a password, and password sign-in is only on for admins. Tick the box to confirm ${facts.self ? "you" : "they"} can sign in another way first.`,
      );
    }
    // Counted and changed together, so two admins removing each other at once can't leave nobody.
    const removed = await serializable(async (tx) => {
      if ((await tx.user.count({ where: { isAdmin: true } })) <= 1) return false;
      await tx.user.update({ where: { id: target.id }, data: { isAdmin: false } });
      return true;
    });
    if (!removed) throw new UserError(facts.self ? "You're the only workspace admin. Add another admin before you remove yourself." : "There has to be at least one workspace admin.");
    await logActivity({
      actor: admin,
      kind: "people",
      action: facts.self ? "Stopped being a workspace admin" : `Removed ${facts.name} as a workspace admin`,
      detail: [target.email, facts.signInRisk ? "confirmed they can sign in without a password" : ""].filter(Boolean).join(" · "),
    });
    revalidatePath("/workspace");
    return { self: facts.self };
  });
}
