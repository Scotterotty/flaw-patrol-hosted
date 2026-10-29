"use server";

import { logActivity } from "@/lib/activity";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";

async function requireWorkspaceAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new UserError("Only a workspace admin can do that.");
  return user;
}

// A reset takes XP back to 0. Titles and frames earned before it go too, except the Early Adopter ones.
// The satchel empties with it, so worn quest gear comes off; the chosen pawn and color stay.
const resetData = (at: Date) => ({ xpSince: at, questGear: {}, questGearTouched: [], questGearAuto: [] });
const clearPicks = (where: Prisma.UserWhereInput) => [
  db.user.updateMany({ where: { ...where, gameTitle: { not: "early" } }, data: { gameTitle: null } }),
  db.user.updateMany({ where: { ...where, gameFrame: { not: "fresh" } }, data: { gameFrame: null } }),
];

/** Start one person's XP again from 0, or everyone's when userId is null. */
export async function resetXp(userId: string | null) {
  return attempt(async () => {
    const admin = await requireWorkspaceAdmin();
    const where = userId ? { id: userId } : {};
    const who = userId ? await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }) : null;
    await logActivity({ actor: admin, kind: "settings", action: who ? `Reset ${who.name ?? who.email}'s mini game XP` : "Reset everyone's mini game XP" });
    await db.$transaction([
      db.user.updateMany({ where, data: resetData(new Date()) }),
      ...clearPicks(where),
    ]);
    revalidatePath("/", "layout");
    return {};
  });
}

/**
 * Go live: everyone's XP starts again from 0, and everyone who has signed in
 * so far keeps the Early Adopter title. Happens once.
 */
export async function launchGame(confirm: string) {
  return attempt(async () => {
    await requireWorkspaceAdmin();
    if (confirm.trim().toUpperCase() !== "GO LIVE") throw new UserError("Type GO LIVE to confirm.");
    const at = new Date();
    const done = await db.$transaction(async (tx) => {
      const ws = await tx.workspace.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
      if (ws.launchedAt) return false;
      await tx.workspace.update({ where: { id: 1 }, data: { launchedAt: at } });
      await tx.user.updateMany({ where: { lastLoginAt: { not: null } }, data: { earlyAdopter: true } });
      await tx.user.updateMany({ data: resetData(at) });
      await tx.user.updateMany({ where: { gameTitle: { not: "early" } }, data: { gameTitle: null } });
      await tx.user.updateMany({ where: { gameFrame: { not: "fresh" } }, data: { gameFrame: null } });
      return true;
    });
    if (!done) throw new UserError("Flaw Patrol has already gone live.");
    revalidatePath("/", "layout");
    return {};
  });
}
