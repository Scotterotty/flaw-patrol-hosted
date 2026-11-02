"use server";

import { logActivity } from "@/lib/activity";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { libraryProjectIds } from "@/lib/umbrella";
import { attempt, UserError } from "./result";

const suiteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().max(5000).default(""),
  caseIds: z.array(z.string()).max(5000),
  changeNote: z.string().trim().max(500).default(""),
});

type Tx = Prisma.TransactionClient;

/** Save a new suite version if the name or case list differs from the latest one. */
async function snapshot(tx: Tx, suiteId: string, user: { id: string; name: string | null; email: string }, changeNote: string) {
  const suite = await tx.testSuite.findUniqueOrThrow({
    where: { id: suiteId },
    include: { cases: { orderBy: { position: "asc" } }, versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const caseIds = suite.cases.map((c) => c.caseId);
  const latest = suite.versions[0];
  if (latest && latest.name === suite.name && JSON.stringify(latest.caseIds) === JSON.stringify(caseIds)) return suite.currentVersion;
  const version = latest ? latest.version + 1 : 1;
  await tx.suiteVersion.create({
    data: { suiteId, version, name: suite.name, caseIds, changeNote, authorId: user.id, authorName: user.name ?? user.email },
  });
  await tx.testSuite.update({ where: { id: suiteId }, data: { currentVersion: version } });
  return version;
}

/** Create or update a suite; caseIds is the full ordered membership. */
export async function saveSuite(projectId: string, suiteId: string | null, input: z.input<typeof suiteSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "suite:manage");
    const data = suiteSchema.parse(input);
    const caseIds = [...new Set(data.caseIds)];
    // Under an umbrella a suite can hold the umbrella's Case library cases too.
    const valid = await db.testCase.count({ where: { id: { in: caseIds }, projectId: { in: await libraryProjectIds(project) } } });
    if (valid !== caseIds.length) throw new UserError("Some cases no longer exist. Reload and try again.");

    const id = await db.$transaction(async (tx) => {
      let id = suiteId;
      if (id) {
        const found = await tx.testSuite.findFirst({ where: { id, projectId } });
        if (!found) throw new UserError("Suite not found.");
        await tx.testSuite.update({ where: { id }, data: { name: data.name, description: data.description } });
        await tx.suiteCase.deleteMany({ where: { suiteId: id } });
      } else {
        id = (await tx.testSuite.create({ data: { projectId, name: data.name, description: data.description } })).id;
      }
      await tx.suiteCase.createMany({ data: caseIds.map((caseId, position) => ({ suiteId: id!, caseId, position })) });
      await snapshot(tx, id, user, data.changeNote || (suiteId ? "" : "Created"));
      return id;
    });
    revalidatePath(`/p/${project.key}`, "layout");
    return { id };
  });
}

/** Append cases to a suite, e.g. from a selection in the case list. */
export async function addCasesToSuite(projectId: string, suiteId: string, caseIds: string[]) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "suite:manage");
    const suite = await db.testSuite.findFirst({ where: { id: suiteId, projectId }, include: { cases: true } });
    if (!suite) throw new UserError("Suite not found.");
    const have = new Set(suite.cases.map((c) => c.caseId));
    const valid = await db.testCase.findMany({ where: { id: { in: caseIds }, projectId: { in: await libraryProjectIds(project) } }, select: { id: true } });
    const add = valid.map((c) => c.id).filter((id) => !have.has(id));
    let pos = suite.cases.reduce((m, c) => Math.max(m, c.position), -1);
    await db.$transaction(async (tx) => {
      await tx.suiteCase.createMany({ data: add.map((caseId) => ({ suiteId, caseId, position: ++pos })) });
      await snapshot(tx, suiteId, user, `Added ${add.length} cases`);
    });
    revalidatePath(`/p/${project.key}`, "layout");
    return { added: add.length };
  });
}

/** Change only a suite's name. Saves a new version noted as a rename, so old runs keep the name they ran under. */
export async function renameSuite(projectId: string, suiteId: string, name: string) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "suite:manage");
    const next = z.string().trim().min(1, "Give the suite a name.").max(200, "Keep the name under 200 characters.").parse(name);
    const suite = await db.testSuite.findFirst({ where: { id: suiteId, projectId }, select: { name: true } });
    if (!suite) throw new UserError("Suite not found.");
    if (suite.name === next) return { name: next };
    await db.$transaction(async (tx) => {
      await tx.testSuite.update({ where: { id: suiteId }, data: { name: next } });
      await snapshot(tx, suiteId, user, `Renamed from "${suite.name}", cases unchanged`);
    });
    await logActivity({ actor: user, kind: "settings", action: `Renamed suite "${suite.name}" to "${next}"`, project });
    revalidatePath(`/p/${project.key}`, "layout");
    return { name: next };
  });
}

export async function setSuiteArchived(projectId: string, suiteId: string, archived: boolean) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "library:archive");
    await db.testSuite.updateMany({ where: { id: suiteId, projectId }, data: { archived } });
    const suite = await db.testSuite.findUnique({ where: { id: suiteId }, select: { name: true } });
    await logActivity({ actor: user, kind: "delete", action: `${archived ? "Archived" : "Restored"} suite "${suite?.name ?? ""}"`, project });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
