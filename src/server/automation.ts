"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { nearTitle, sameTitle, titleFromTest } from "@/lib/automation";
import { duplicateOf, hashOf, libraryOf, matchAll, read, saveAutomationRun, type Files, type saveSchema } from "@/lib/automation-save";
import { db } from "@/lib/db";
import { parseFileSettings, type MediaCounts } from "@/lib/automation-files";
import { countMedia, keptFor, matchMedia } from "@/lib/automation-media";
import { dropStage, loadStage } from "@/lib/media-stage";
import { can } from "@/lib/permissions";
import { requireProjectAction, requireUser } from "@/lib/session";
import { loadUmbrella, platformColor, umbrellaOf } from "@/lib/umbrella";
import { attempt, UserError } from "./result";

// Upload automation results (ver_82, milestone 3): JUnit or NUnit XML from any CI
// server or a local test run becomes a closed, automated run in one test cycle.
// Tests find their case by Automation ID, then by a case key in the test's name;
// the rest become Automated cases in the library's Automation folder.

/** Step 1: what's in the files, before a test cycle is picked. */
export async function readAutomationFiles(files: Files) {
  return attempt(async () => {
    await requireUser();
    const { tests, build } = read(files);
    if (!tests.length) throw new UserError("That file has no test results in it.");
    return { tests: tests.length, build };
  });
}

export type UploadCycle = { id: string; key: string; name: string; color: string; rcName: string; current: boolean };

/** The test cycles the viewer can upload results into: open ones in the umbrella, or the lone test cycle. */
export async function automationCycles(scope: { groupId: string } | { projectKey: string }) {
  return attempt(async () => {
    const user = await requireUser();
    let cycles: UploadCycle[] = [];
    let groupId: string | null = null;
    if ("groupId" in scope) groupId = scope.groupId;
    else {
      const p = await db.project.findUnique({ where: { key: scope.projectKey.toUpperCase() } });
      if (!p) throw new UserError("Test cycle not found.");
      const u = await umbrellaOf(p);
      if (u) groupId = u.group.id;
      else {
        await requireProjectAction(p.id, "run:import");
        cycles = [{ id: p.id, key: p.key, name: p.name, color: "#94a3b8", rcName: p.rcName, current: true }];
      }
    }
    if (groupId) {
      const u = await loadUmbrella(groupId, user);
      if (!u) throw new UserError("This umbrella isn't available.");
      const current = new Set(u.current.map((p) => p.id));
      const live = [...u.current, ...u.older.filter((p) => !p.archivedAt)];
      const roles = await db.projectMember.findMany({ where: { userId: user.id, projectId: { in: live.map((p) => p.id) } }, select: { projectId: true, role: true } });
      const roleOf = new Map(roles.map((r) => [r.projectId, r.role]));
      cycles = live
        .filter((p) => can({ role: user.isAdmin ? "ADMIN" : (roleOf.get(p.id) ?? null), rules: u.who.rules }, "run:import"))
        .map((p) => ({ id: p.id, key: p.key, name: p.name, color: platformColor(u.platforms, p.platform), rcName: p.rcName, current: current.has(p.id) }));
      if (!cycles.length) throw new UserError(live.length ? `You can't upload results to any ${u.group.name} test cycle. A lead or admin can.` : `${u.group.name} has no test cycles yet. Add one first: a run always goes in a test cycle.`);
    }
    return { cycles };
  });
}

/** Step 3: how each test matches, before anything is saved. */
export async function previewAutomation(cycleId: string, files: Files, links: Record<string, string> = {}, stageId?: string) {
  return attempt(async () => {
    const { user } = await requireProjectAction(cycleId, "run:import");
    const { list, tests, build } = read(files);
    // Screenshots, videos and replays (ver_93): what's there and what this umbrella keeps.
    let media: { found: MediaCounts; kept: MediaCounts; unmatched: number; keep: "failed" | "all" } | null = null;
    const staged = await loadStage(stageId, user.id);
    if (staged.length) {
      const project = await db.project.findUniqueOrThrow({ where: { id: cycleId }, select: { group: { select: { automationFiles: true } } } });
      const settings = parseFileSettings(project.group?.automationFiles);
      const { byTest, unmatched } = matchMedia(tests, staged);
      media = { found: countMedia(staged), kept: countMedia(tests.flatMap((t) => keptFor(t, byTest.get(t.id) ?? [], settings))), unmatched, keep: settings.keep };
    }
    const { cycle, cases, keys } = await libraryOf(cycleId);
    const matches = matchAll(tests, cases, keys, links);
    const byId = new Map(cases.map((c) => [c.id, c]));
    const rows = tests.map((t) => {
      const m = matches.get(t.id);
      const c = m ? byId.get(m.caseId)! : null;
      // No match, but a case with the same title: suggest it, so the upload doesn't make a twin (ver_86).
      // Near titles too (ver_94): case and simple endings like "Adds"/"Add" don't make a new case without asking.
      const like = c ? null : (cases.find((x) => sameTitle(x.title, titleFromTest(t.name))) ?? cases.find((x) => nearTitle(x.title, titleFromTest(t.name))));
      return {
        id: t.id,
        status: t.status,
        crashed: t.crashed,
        match: c ? { caseId: c.id, key: c.key, title: c.title, by: m!.by } : null,
        suggest: like ? { caseId: like.id, key: like.key, title: like.title } : null,
      };
    });
    return {
      build,
      rcName: cycle.rcName,
      rows,
      library: cases.map((c) => ({ id: c.id, key: c.key, title: c.title })),
      duplicate: await duplicateOf(cycleId, hashOf(list)),
      media,
    };
  });
}

/** Save the upload as one closed, automated run in the test cycle. */
export async function saveAutomation(cycleId: string, files: Files, input: z.input<typeof saveSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(cycleId, "run:import");
    const media = await loadStage(input.stageId, user.id);
    const res = await saveAutomationRun(project, files, input, { id: user.id, name: user.name ?? user.email }, { media });
    await dropStage(input.stageId);
    return res;
  });
}

/** File bug on an automated failure: link the bug the dialog made to that result. */
export async function linkAutomationBug(projectId: string, resultId: string, defectId: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:execute");
    const result = await db.testResult.findFirst({ where: { id: resultId, run: { projectId }, automated: true } });
    if (!result) throw new UserError("That result is no longer here.");
    await db.defectLink.upsert({ where: { defectId_resultId: { defectId, resultId } }, create: { defectId, resultId, stepIndex: null }, update: {} });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
