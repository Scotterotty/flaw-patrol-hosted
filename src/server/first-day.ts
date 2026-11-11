"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withFirstWord, type FirstWord } from "@/lib/first-day";
import { requireUser } from "@/lib/session";
import { attempt } from "./result";

async function setWord(k: FirstWord, on: boolean) {
  const user = await requireUser();
  const me = await db.user.findUnique({ where: { id: user.id }, select: { openCards: true } });
  await db.user.update({ where: { id: user.id }, data: { openCards: withFirstWord(me?.openCards ?? [], k, on) } });
}

/** ✕ Hide for now on Start here (true), or Show Start here again (false). Your ticks are kept either way. */
export async function hideStartHere(hidden: boolean) {
  return attempt(async () => {
    await setWord("startHidden", hidden === true);
    revalidatePath("/", "layout");
    return {};
  });
}

/** Got it on the one-time "You're set" card. */
export async function closeAllSet() {
  return attempt(async () => {
    await setWord("setSeen", true);
    return {};
  });
}

/** A new case's More details: left open or closed, for next time. */
export async function rememberCaseDetails(open: boolean) {
  return attempt(async () => {
    await setWord("caseDetails", open === true);
    return {};
  });
}
