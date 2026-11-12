"use server";

import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { groupCards, type StatusCard, type StatusSource } from "@/lib/status-cards";
import { loadUmbrella } from "@/lib/umbrella";
import { checkCard, statusSources } from "./status-checks";
import { attempt, UserError } from "./result";

// Status page (ver_228): everyone in the umbrella sees every card, Viewers too.
// Connecting tools stays in Settings for Admins.

async function umbrellaFor(groupId: string) {
  const user = await requireUser();
  const u = await loadUmbrella(groupId, user);
  if (!u) throw new UserError("You're not on this umbrella's team.");
  return u;
}

/** What's connected, by name, without asking any tool. */
export async function statusList(groupId: string) {
  return attempt(async () => {
    const u = await umbrellaFor(groupId);
    return { sources: await statusSources(u), canManage: can(u.who, "jira:manage") && !u.group.archivedAt };
  });
}

/** One card. Refresh passes fresh, which asks the tool again unless it was asked in the last few seconds. */
export async function statusCheck(groupId: string, key: string, fresh = false) {
  return attempt(async () => {
    const u = await umbrellaFor(groupId);
    const src = (await statusSources(u)).find((s) => s.key === key);
    if (!src) throw new UserError("That isn't connected any more. Refresh the page.");
    return { card: await checkCard(u, src, !!fresh) };
  });
}

/** Overview's one line: how many cards need a look. Total 0 when nothing is connected. */
export async function statusSummary(groupId: string) {
  return attempt(async () => {
    const u = await umbrellaFor(groupId);
    const sources: StatusSource[] = await statusSources(u);
    const cards: StatusCard[] = await Promise.all(sources.map((s) => checkCard(u, s)));
    return { total: cards.length, bad: groupCards(cards).bad.length };
  });
}
