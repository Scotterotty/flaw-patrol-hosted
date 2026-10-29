"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { projectAccess, requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";
import { listWrapUps, releaseStart, type WrapPick } from "@/lib/wrap-ups";
import { attempt, UserError } from "./result";

const scopeSchema = z.union([z.object({ groupId: z.string() }), z.object({ projectKey: z.string() })]);
export type WrapScope = z.input<typeof scopeSchema>;

/** The projects behind a report the viewer can open: an umbrella's, or one test cycle's. */
async function projectsOf(scope: WrapScope) {
  const s = scopeSchema.parse(scope);
  if ("groupId" in s) {
    const u = await loadUmbrella(s.groupId, await requireUser());
    if (!u) throw new UserError("That umbrella isn't there any more.");
    return [u.hub.id, ...u.projects.map((p) => p.id)];
  }
  const { project } = await projectAccess(s.projectKey);
  return [project.id];
}

/** Wrap-ups to pick from: Today (from the viewer's own midnight), This week, or This release. */
export async function wrapUpChoices(scope: WrapScope, range: { since?: string; release?: string }) {
  return attempt(async () => {
    const projectIds = await projectsOf(scope);
    const since = range.release ? await releaseStart(projectIds, range.release) : range.since ? new Date(range.since) : null;
    if (!since || isNaN(since.getTime())) return { list: [] };
    return { list: await listWrapUps(projectIds, { since }) };
  });
}

const pickSchema = z.object({ key: z.string().max(300), ids: z.array(z.string().max(80)).max(100), auto: z.boolean() });

/** Remember which wrap-ups a report carries for this person. */
export async function saveWrapUps(input: z.input<typeof pickSchema>) {
  return attempt(async () => {
    const user = await requireUser();
    const { key, ids, auto } = pickSchema.parse(input);
    const prefs = user.rcReport && typeof user.rcReport === "object" && !Array.isArray(user.rcReport) ? (user.rcReport as Record<string, unknown>) : {};
    const wrapUps = { ...((prefs.wrapUps as Record<string, WrapPick> | undefined) ?? {}), [key]: { ids, auto } };
    await db.user.update({ where: { id: user.id }, data: { rcReport: { ...prefs, wrapUps } as Prisma.InputJsonValue } });
    revalidatePath("/", "layout");
    return {};
  });
}
