"use server";

import { db } from "@/lib/db";
import { TREND_COUNTS, withTrendPrefs } from "@/lib/home-trends-calc";
import { requireUser } from "@/lib/session";
import { attempt } from "./result";

/** How testing is going: Hide and how many releases or weeks to show, saved for this person only. */
export async function saveHomeTrendPrefs(prefs: { hidden: boolean; count: number }) {
  return attempt(async () => {
    const user = await requireUser();
    const count = TREND_COUNTS.find((c) => c === prefs?.count) ?? 6;
    const me = await db.user.findUnique({ where: { id: user.id }, select: { openCards: true } });
    await db.user.update({ where: { id: user.id }, data: { openCards: withTrendPrefs(me?.openCards ?? [], { hidden: prefs?.hidden === true, count }) } });
    return {};
  });
}
