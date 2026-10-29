"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { BUILD } from "@/lib/whats-new";

/** Got it, ✕, Esc or a click outside: this version's window won't open by itself again. */
export async function markWhatsNewSeen() {
  const user = await requireUser();
  if ((user.whatsNewSeen ?? 0) < BUILD) await db.user.update({ where: { id: user.id }, data: { whatsNewSeen: BUILD } });
}
