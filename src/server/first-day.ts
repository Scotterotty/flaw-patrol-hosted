"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withFirstWord, type FirstWord } from "@/lib/first-day";
import { requireUser } from "@/lib/session";
import { umbrellaOf } from "@/lib/umbrella";
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

/**
 * Getting started / Show Start here again: Start here lives on an umbrella's Overview, so open the
 * umbrella you're working in. From a test cycle or the hub (/p/KEY), its umbrella; anywhere else
 * (Umbrellas list, your account), the umbrella you last opened, or your only one. The Umbrellas
 * list only when you're in none yet (making one is the first step there).
 */
export async function showStartHere(pathname: string) {
  return attempt(async () => {
    await setWord("startHidden", false);
    revalidatePath("/", "layout");
    return { href: await startHereHref(pathname) };
  });
}

async function startHereHref(pathname: string): Promise<string> {
  const user = await requireUser();
  const g = /^\/g\/([^/?#]+)/.exec(pathname);
  if (g) return `/g/${g[1]}`;
  const live = (id: string | undefined | null, archivedAt?: Date | null) => (id && !archivedAt ? `/g/${id}` : null);
  const p = /^\/p\/([^/?#]+)/.exec(pathname);
  if (p) {
    const project = await db.project.findUnique({ where: { key: decodeURIComponent(p[1]) }, select: { id: true, groupId: true } });
    const u = project ? await umbrellaOf(project) : null;
    const href = live(u?.group.id, u?.group.archivedAt);
    if (href) return href;
  }
  const mine = { hubProjectId: { not: null }, archivedAt: null, hub: { practiceFor: null, members: { some: { userId: user.id } } } } as const;
  const recent = await db.projectPin.findMany({
    where: { userId: user.id, visitedAt: { not: null } },
    orderBy: { visitedAt: "desc" },
    take: 10,
    select: { project: { select: { id: true, groupId: true } } },
  });
  for (const r of recent) {
    const u = await umbrellaOf(r.project);
    if (!u || u.group.archivedAt) continue;
    if (user.isAdmin || (await db.projectGroup.count({ where: { id: u.group.id, ...mine } }))) return `/g/${u.group.id}`;
  }
  const umbrellas = await db.projectGroup.findMany({ where: mine, select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 });
  return umbrellas.length ? `/g/${umbrellas[0].id}` : "/";
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
