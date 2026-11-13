"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";

// Workspace settings → Admins: a workspace admin makes another person a workspace admin, or
// takes it away. The last workspace admin can never be removed, so nobody gets locked out.

const userId = z.string().min(1).max(100);

async function requireWorkspaceAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new UserError("Only a workspace admin can do that.");
  return user;
}

const nameOf = (u: { name: string | null; email: string }) => u.name || u.email;

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

/** Take workspace admin away. They keep their project roles. Refuses for the last admin. */
export async function removeWorkspaceAdmin(id: string) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const target = await db.user.findUnique({ where: { id: userId.parse(id) }, select: { id: true, name: true, email: true, isAdmin: true } });
    if (!target?.isAdmin) return { self: target?.id === admin.id };
    // Counted and changed together, so two admins removing each other at once can't leave nobody.
    const removed = await db.$transaction(
      async (tx) => {
        const admins = await tx.user.count({ where: { isAdmin: true } });
        if (admins <= 1) return false;
        await tx.user.update({ where: { id: target.id }, data: { isAdmin: false } });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!removed) throw new UserError(target.id === admin.id ? "You're the only workspace admin. Add another admin before you remove yourself." : "There has to be at least one workspace admin.");
    const self = target.id === admin.id;
    await logActivity({ actor: admin, kind: "people", action: self ? "Stopped being a workspace admin" : `Removed ${nameOf(target)} as a workspace admin`, detail: target.email });
    revalidatePath("/workspace");
    return { self };
  });
}
