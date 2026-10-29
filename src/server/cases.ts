"use server";

import { splitBracketTitle } from "@/lib/tags";
import { platformNamesFor } from "@/lib/tag-data";
import { logActivity } from "@/lib/activity";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { charterSchema, parseCharter } from "@/lib/charter";
import { db } from "@/lib/db";
import { pathOf } from "@/lib/folders";
import { normalizeTags } from "@/lib/format";
import { requireProjectAction } from "@/lib/session";
import { caseStepItemSchema, cleanSteps, sharedStepIdsIn, type CaseStepItem } from "@/lib/steps";
import { attempt, UserError } from "./result";

const caseInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(500),
  preconditions: z.string().max(10000).default(""),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  type: z.enum(["MANUAL", "AUTOMATED", "EXPLORATORY"]),
  automationId: z.string().trim().max(200).nullable().default(null),
  tags: z.array(z.string().max(50)).max(30).default([]),
  folderId: z.string().nullable().default(null),
  steps: z.array(caseStepItemSchema).max(500),
  // Only for EXPLORATORY cases (charters), which have no steps.
  charter: charterSchema.nullable().default(null),
  personaId: z.string().nullable().default(null),
  changeNote: z.string().trim().max(500).default(""),
});
export type CaseInput = z.input<typeof caseInputSchema>;

type Tx = Prisma.TransactionClient;

async function validateRefs(tx: Tx, projectId: string, folderId: string | null, steps: CaseStepItem[]) {
  if (folderId && !(await tx.folder.findFirst({ where: { id: folderId, projectId } }))) throw new UserError("Folder not found.");
  const ids = sharedStepIdsIn(steps);
  if (ids.length) {
    const found = await tx.sharedStep.count({ where: { id: { in: ids }, projectId } });
    if (found !== ids.length) throw new UserError("One of the shared steps no longer exists.");
  }
}

async function folderPathString(tx: Tx, projectId: string, folderId: string | null) {
  if (!folderId) return "";
  const rows = await tx.folder.findMany({ where: { projectId }, select: { id: true, parentId: true, name: true } });
  return pathOf(rows, folderId).join(" / ");
}

/** Create a case, or save a new version of an existing one. */
export async function saveCase(projectId: string, caseId: string | null, input: CaseInput) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const data = caseInputSchema.parse(input);
    // Bracket tags (ver_96): a title typed as "[WEB] - Sign in" saves as the tag Web and "Sign in".
    const split = splitBracketTitle(data.title, { platforms: await platformNamesFor(projectId) });
    if (split.tags.length) {
      data.title = split.title;
      data.tags = [...split.tags, ...data.tags.filter((t) => !split.tags.some((x) => x.toLowerCase() === t.toLowerCase()))];
    }
    const isCharter = data.type === "EXPLORATORY";
    if (isCharter && !data.charter) throw new UserError("A charter needs its mission.");
    const steps = isCharter ? [] : cleanSteps(data.steps);
    const charter = isCharter ? data.charter : null;
    const tags = normalizeTags(data.tags);
    const automationId = data.automationId || null;
    const author = { authorId: user.id, authorName: user.name ?? user.email };

    const result = await db.$transaction(async (tx) => {
      await validateRefs(tx, projectId, data.folderId, steps);
      const folderPath = await folderPathString(tx, projectId, data.folderId);
      const persona = data.personaId ? await tx.persona.findFirst({ where: { id: data.personaId, projectId } }) : null;
      if (data.personaId && !persona) throw new UserError("That persona no longer exists.");
      const snapshot = {
        title: data.title,
        preconditions: data.preconditions,
        priority: data.priority,
        type: data.type,
        automationId,
        tags,
        folderPath,
        steps: steps as Prisma.InputJsonValue,
        charter: charter ?? Prisma.DbNull,
        personaName: persona?.name ?? "",
      };
      const fields = {
        title: data.title,
        preconditions: data.preconditions,
        priority: data.priority,
        type: data.type,
        automationId,
        tags,
        folderId: data.folderId,
        personaId: persona?.id ?? null,
      };

      if (!caseId) {
        const { caseSeq } = await tx.project.update({ where: { id: projectId }, data: { caseSeq: { increment: 1 } } });
        const created = await tx.testCase.create({
          data: {
            ...fields,
            projectId,
            number: caseSeq,
            currentVersion: 1,
            versions: { create: { ...snapshot, ...author, version: 1, changeNote: data.changeNote || "Created" } },
            sharedUsages: { create: sharedStepIdsIn(steps).map((sharedStepId) => ({ sharedStepId })) },
          },
        });
        return { number: created.number, version: 1, changed: true };
      }

      const existing = await tx.testCase.findFirst({
        where: { id: caseId, projectId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!existing) throw new UserError("Case not found.");
      const latest = existing.versions[0];
      const unchanged =
        latest &&
        latest.title === snapshot.title &&
        latest.preconditions === snapshot.preconditions &&
        latest.priority === snapshot.priority &&
        latest.type === snapshot.type &&
        latest.automationId === snapshot.automationId &&
        JSON.stringify(latest.tags) === JSON.stringify(tags) &&
        JSON.stringify(latest.steps) === JSON.stringify(steps) &&
        JSON.stringify(latest.charter ?? null) === JSON.stringify(charter) &&
        latest.personaName === snapshot.personaName;

      if (unchanged) {
        // A pure folder move isn't a content change, so it doesn't add a version.
        await tx.testCase.update({ where: { id: caseId }, data: { folderId: data.folderId, personaId: persona?.id ?? null } });
        return { number: existing.number, version: existing.currentVersion, changed: false };
      }

      const version = existing.currentVersion + 1;
      await tx.caseVersion.create({ data: { ...snapshot, ...author, caseId, version, changeNote: data.changeNote } });
      await tx.testCase.update({ where: { id: caseId }, data: { ...fields, currentVersion: version } });
      await tx.caseSharedStep.deleteMany({ where: { caseId } });
      await tx.caseSharedStep.createMany({ data: sharedStepIdsIn(steps).map((sharedStepId) => ({ caseId, sharedStepId })) });
      return { number: existing.number, version, changed: true };
    });

    revalidatePath(`/p/${project.key}`, "layout");
    return result;
  });
}

/** Copy an old version's content into a new latest version. */
export async function restoreCaseVersion(projectId: string, caseId: string, version: number) {
  return attempt(async () => {
    await requireProjectAction(projectId, "case:edit");
    const testCase = await db.testCase.findFirstOrThrow({ where: { id: caseId, projectId } });
    const old = await db.caseVersion.findUniqueOrThrow({ where: { caseId_version: { caseId, version } } });
    const res = await saveCase(projectId, caseId, {
      title: old.title,
      preconditions: old.preconditions,
      priority: old.priority,
      type: old.type,
      automationId: old.automationId,
      tags: old.tags,
      folderId: testCase.folderId,
      steps: old.steps as CaseStepItem[],
      charter: old.charter ? parseCharter(old.charter) : null,
      personaId: testCase.personaId,
      changeNote: `Restored version ${version}`,
    });
    if (!res.ok) throw new UserError(res.error);
    return { version: res.version };
  });
}

export async function setCasesArchived(projectId: string, caseIds: string[], archived: boolean) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:archive");
    const { count } = await db.testCase.updateMany({ where: { id: { in: caseIds }, projectId }, data: { archived } });
    if (count) {
      const cases = await db.testCase.findMany({ where: { id: { in: caseIds }, projectId }, select: { number: true, title: true }, orderBy: { number: "asc" }, take: 6 });
      const list = cases.map((c) => `${project.key}-${c.number}${count === 1 ? ` "${c.title}"` : ""}`).join(", ") + (count > cases.length ? ` and ${count - cases.length} more` : "");
      await logActivity({ actor: user, kind: "delete", action: `${archived ? "Archived" : "Restored"} ${count === 1 ? "test case" : `${count} test cases`}`, project, detail: list });
    }
    revalidatePath(`/p/${project.key}`, "layout");
    return { count };
  });
}

export async function moveCases(projectId: string, caseIds: string[], folderId: string | null) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "case:edit");
    if (folderId && !(await db.folder.findFirst({ where: { id: folderId, projectId } }))) throw new UserError("Folder not found.");
    const { count } = await db.testCase.updateMany({ where: { id: { in: caseIds }, projectId }, data: { folderId } });
    revalidatePath(`/p/${project.key}`, "layout");
    return { count };
  });
}

export async function duplicateCase(projectId: string, caseId: string) {
  return attempt(async () => {
    await requireProjectAction(projectId, "case:edit");
    const c = await db.testCase.findFirstOrThrow({
      where: { id: caseId, projectId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const res = await saveCase(projectId, null, {
      title: `${c.title} (copy)`,
      preconditions: c.preconditions,
      priority: c.priority,
      type: c.type,
      automationId: null,
      tags: c.tags,
      folderId: c.folderId,
      steps: (c.versions[0]?.steps ?? []) as CaseStepItem[],
      charter: c.versions[0]?.charter ? parseCharter(c.versions[0].charter) : null,
      personaId: c.personaId,
    });
    if (!res.ok) throw new UserError(res.error);
    return { number: res.number };
  });
}

const bulkEditSchema = z.object({
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).nullable().default(null),
  type: z.enum(["MANUAL", "AUTOMATED"]).nullable().default(null),
  // undefined keeps each case's persona; null takes it off.
  personaId: z.string().nullable().optional(),
  addTags: z.array(z.string().max(50)).max(30).default([]),
  removeTags: z.array(z.string().max(50)).max(30).default([]),
});
export type BulkEdit = z.input<typeof bulkEditSchema>;

/**
 * Edit fields… on ticked cases: priority, type, persona and tags. Only what was
 * picked changes, and each changed case gets a new version. Charters keep their type.
 */
export async function editCaseFields(projectId: string, caseIds: string[], input: BulkEdit) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const edit = bulkEditSchema.parse(input);
    const add = normalizeTags(edit.addTags);
    const remove = new Set(normalizeTags(edit.removeTags));
    const author = { authorId: user.id, authorName: user.name ?? user.email };
    const persona =
      edit.personaId === undefined ? undefined : edit.personaId === null ? null : await db.persona.findFirst({ where: { id: edit.personaId, projectId } });
    if (edit.personaId && !persona) throw new UserError("That persona no longer exists.");
    const note = [
      edit.priority && `priority ${edit.priority.toLowerCase()}`,
      edit.type && `type ${edit.type.toLowerCase()}`,
      persona !== undefined && (persona ? `persona ${persona.name}` : "no persona"),
      ...add.map((t) => `+${t}`),
      ...[...remove].map((t) => `−${t}`),
    ]
      .filter(Boolean)
      .join(", ");
    const count = await db.$transaction(async (tx) => {
      const cases = await tx.testCase.findMany({
        where: { id: { in: caseIds }, projectId, archived: false },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      let changed = 0;
      for (const c of cases) {
        const latest = c.versions[0];
        if (!latest) continue;
        const tags = normalizeTags([...c.tags.filter((t) => !remove.has(t)), ...add]);
        const next = {
          priority: edit.priority ?? c.priority,
          type: edit.type && c.type !== "EXPLORATORY" ? edit.type : c.type,
          tags,
          personaId: persona === undefined ? c.personaId : (persona?.id ?? null),
        };
        const personaName = persona === undefined ? latest.personaName : (persona?.name ?? "");
        if (next.priority === c.priority && next.type === c.type && next.personaId === c.personaId && JSON.stringify(tags) === JSON.stringify(c.tags)) continue;
        const version = c.currentVersion + 1;
        await tx.caseVersion.create({
          data: {
            caseId: c.id,
            title: latest.title,
            preconditions: latest.preconditions,
            automationId: latest.automationId,
            folderPath: latest.folderPath,
            steps: latest.steps as Prisma.InputJsonValue,
            charter: latest.charter ?? Prisma.DbNull,
            priority: next.priority,
            type: next.type,
            tags,
            personaName,
            ...author,
            version,
            changeNote: `Edited with other cases: ${note}`.slice(0, 500),
          },
        });
        await tx.testCase.update({ where: { id: c.id }, data: { ...next, currentVersion: version } });
        changed++;
      }
      return changed;
    });
    revalidatePath(`/p/${project.key}`, "layout");
    return { count };
  });
}
