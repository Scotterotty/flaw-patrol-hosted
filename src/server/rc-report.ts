"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { readPrefs, releaseKey } from "@/lib/rc-status";
import { requireUser } from "@/lib/session";
import { attempt } from "./result";

const schema = z.object({
  release: z.string().trim().min(1).max(100),
  hide: z.array(z.string().max(40)).max(200),
  add: z.array(z.string().max(40)).max(50),
  bashes: z.boolean().optional(),
});

/** Remember the release someone last looked at, and which runs they picked for it. */
export async function saveRcReport(input: { release: string; hide: string[]; add: string[]; bashes?: boolean }) {
  return attempt(async () => {
    const user = await requireUser();
    const { release, hide, add, bashes } = schema.parse(input);
    const prefs = readPrefs(user.rcReport);
    const picks = { ...prefs.picks, [releaseKey(release)]: { hide, add, ...(bashes ? { bashes } : {}) } };
    // Keep the rest of the prefs, like attached wrap-ups.
    await db.user.update({ where: { id: user.id }, data: { rcReport: { ...prefs, release, picks } as Prisma.InputJsonValue } });
    revalidatePath("/", "layout");
    return {};
  });
}
