"use server";

import { assignable } from "@/lib/assignable";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { parseCharter, parsePersona } from "@/lib/charter";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { can } from "@/lib/permissions";
import { EXPLORE_KIND } from "@/lib/run-kinds";
import { projectMembers } from "@/lib/suite-data";
import { requireProjectAction, requireUser } from "@/lib/session";
import { libraryProjectIds, loadUmbrella, umbrellaOf } from "@/lib/umbrella";
import { alertRunStarted } from "@/lib/slack";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";

// Start exploring: a small box made only for running a charter. No "What kind of
// run?" (it's always 🧭 Exploratory) and no "What to run" (it's this charter). Each person
// picked gets their own copy, so everyone has their own timer and notes.

/** What the Start exploring box needs: the charter, where it can go, and who can explore. */
export async function exploreOptions(caseId: string) {
  return attempt(async () => {
    const user = await requireUser();
    const c = await db.testCase.findUnique({
      where: { id: caseId },
      select: { id: true, number: true, title: true, type: true, archived: true, projectId: true, project: { select: { id: true, key: true, name: true, groupId: true, hubOf: { select: { id: true } } } }, persona: { select: { name: true, emoji: true, description: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { charter: true } } },
    });
    if (!c || c.type !== "EXPLORATORY" || c.archived) throw new UserError("That charter isn't there any more.");
    const charter = parseCharter(c.versions[0]?.charter);
    const groupId = c.project.hubOf?.id ?? (await umbrellaOf(c.project))?.group.id ?? null;
    const umbrella = groupId ? await loadUmbrella(groupId, user) : null;
    // Where it can go: the umbrella's current test cycles, newest first, or the charter's own project.
    const places = umbrella
      ? (await db.project.findMany({ where: { groupId: umbrella.group.id, archivedAt: null, id: { not: umbrella.hub.id } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, key: true } }))
      : [{ id: c.project.id, name: c.project.name, key: c.project.key }];
    const allowed = [];
    for (const p of places) {
      const ok = await requireProjectAction(p.id, "run:create").then(
        () => true,
        () => false,
      );
      if (ok) allowed.push({ ...p, members: assignable(await projectMembers(p.id)).map((m) => ({ id: m.id, name: m.name })) });
    }
    // "No test cycle": the run stays in the umbrella's Case library.
    const libraryOk = umbrella ? can(umbrella.who, "run:create") : false;
    const libraryMembers = umbrella && libraryOk ? assignable(await projectMembers(umbrella.hub.id)).map((m) => ({ id: m.id, name: m.name })) : [];
    if (!allowed.length && !libraryOk) throw new UserError("You can't start runs here. Ask an admin to add you.");
    return {
      charter: { id: c.id, key: caseKey(c.project.key, c.number), title: c.title, explore: charter.explore, with: charter.with, discover: charter.discover, minutes: charter.minutes, persona: c.persona ? parsePersona(c.persona) : null },
      places: allowed,
      library: umbrella && libraryOk ? { id: umbrella.hub.id, members: libraryMembers } : null,
      meId: user.id,
    };
  });
}
export type ExploreOptions = Extract<Awaited<ReturnType<typeof exploreOptions>>, { ok: true }>;

const startSchema = z.object({
  placeId: z.string(),
  minutes: z.number().int().min(5).max(480),
  /** null: just me. Otherwise each person picked gets their own copy. */
  people: z.array(z.string()).max(50).nullable(),
  name: z.string().trim().max(200).default(""),
});

export async function startExploring(caseId: string, input: z.input<typeof startSchema>) {
  return attempt(async () => {
    const data = startSchema.parse(input);
    const { project, user } = await requireProjectAction(data.placeId, "run:create");
    const c = await db.testCase.findUnique({ where: { id: caseId }, select: { id: true, title: true, type: true } });
    if (!c || c.type !== "EXPLORATORY") throw new UserError("That charter isn't there any more.");
    const library = await libraryProjectIds(project);
    const team = new Set((await db.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true } })).map((m) => m.userId));
    const people = data.people === null ? [user.id] : [...new Set(data.people)];
    if (!people.length) throw new UserError("Pick who explores.");
    for (const id of people) if (id !== user.id && !team.has(id) && !user.isAdmin) throw new UserError(`Someone picked isn't a member of ${project.name}.`);
    const name = data.name || `Explore: ${c.title}`.slice(0, 200);
    const runs = await db.$transaction(
      async (tx) => {
        const made: { number: number; entryId: string; userId: string; runId: string }[] = [];
        for (const userId of people) {
          const entries = await buildEntries(tx, library, [c.id], userId);
          if (!entries.length) throw new UserError("That charter isn't in this test cycle's library.");
          // The time limit picked here, for this run only.
          const e = entries[0];
          e.charter = { ...((e.charter as Prisma.JsonObject | null) ?? {}), minutes: data.minutes } as Prisma.InputJsonValue;
          const { runSeq } = await tx.project.update({ where: { id: project.id }, data: { runSeq: { increment: 1 } } });
          const run = await tx.testRun.create({
            data: {
              projectId: project.id,
              number: runSeq,
              name,
              kind: EXPLORE_KIND,
              release: project.rcName,
              createdById: user.id,
              createdBy: user.name ?? user.email,
              entries: { create: entries.map(({ assigneeId, ...x }) => ({ ...x, assigneeId })) },
            },
            include: { entries: { select: { id: true } } },
          });
          made.push({ number: run.number, entryId: run.entries[0].id, userId, runId: run.id });
        }
        return made;
      },
      { timeout: 60_000 },
    );
    await logActivity({ actor: user, kind: "run", action: runs.length === 1 ? `Started exploring R${runs[0].number} "${name}"` : `Started ${runs.length} exploring runs "${name}"`, project });
    for (const r of runs) await alertRunStarted(project, r.runId, user.name ?? user.email).catch(() => {});
    revalidatePath(`/p/${project.key}`, "layout");
    const mine = runs.find((r) => r.userId === user.id) ?? null;
    return { key: project.key, mine: mine && { number: mine.number, entryId: mine.entryId }, count: runs.length, first: runs[0].number };
  });
}
