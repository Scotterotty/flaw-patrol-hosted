"use server";

import { splitBracketTitle } from "@/lib/tags";
import { applyAreaWord } from "@/lib/area-tags";
import { areaContextFor, knownTagNamesFor } from "@/lib/tag-data";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeTags } from "@/lib/format";
import { requireProjectAction } from "@/lib/session";
import { plainStepSchema, sharedStepIdsIn } from "@/lib/steps";
import { MAX_IMPORT } from "@/lib/csv-import";
import { attempt, UserError } from "./result";

const importedCaseSchema = z.object({
  title: z.string().trim().min(1).max(500),
  folderPath: z.array(z.string().trim().min(1).max(100)).max(10),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  tags: z.array(z.string().max(50)),
  preconditions: z.string().max(10000),
  steps: z.array(plainStepSchema).max(500),
  type: z.enum(["MANUAL", "AUTOMATED"]),
  automationId: z.string().max(200).nullable(),
  stories: z.array(z.string().regex(/^[A-Z][A-Z0-9]{1,9}-\d+$/)).max(50).default([]),
  sourceId: z.string().trim().max(200).default(""),
  items: z
    .array(z.discriminatedUnion("kind", [plainStepSchema.extend({ kind: z.literal("step") }), z.object({ kind: z.literal("shared"), key: z.string().min(1).max(20) })]))
    .max(500)
    .optional(),
});

const folderName = z.string().trim().min(1).max(100).refine((n) => !/[/>\\]/.test(n), "Folder names can't contain / > or \\");

const importedSharedSchema = z.object({
  key: z.string().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  steps: z.array(plainStepSchema).min(1).max(100),
});

/**
 * Create cases from a parsed spreadsheet. Folder paths are created under the
 * chosen target folder as needed; existing folders with the same name are reused.
 * Blocks of steps several cases share become shared steps, reusing one with the
 * same name and steps if an earlier import already made it.
 */
export async function importCases(projectId: string, folderId: string | null, rawCases: unknown, fileName: string, rawShared: unknown = [], rawNewFolder = "", rawArea: unknown = { words: [], skip: [] }, rawRunBefore: unknown = false) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "import");
    let targetFolderId = folderId;
    const cases = z.array(importedCaseSchema).max(MAX_IMPORT, `Import at most ${MAX_IMPORT} cases at a time`).parse(rawCases);
    const sharedDefs = z.array(importedSharedSchema).max(MAX_IMPORT).parse(rawShared);
    // Area tags: the words after the platform the preview turned into tags, and new ones left unticked.
    const areaList = z.array(z.string().trim().min(1).max(24)).max(500);
    const area = z.object({ words: areaList, skip: areaList }).parse(rawArea);
    // "Have these cases been run before?": yes means runs don't tag them New.
    const runBefore = z.boolean().parse(rawRunBefore);
    if (!cases.length) throw new UserError("There are no cases to import.");
    if (targetFolderId && !(await db.folder.findFirst({ where: { id: targetFolderId, projectId } }))) {
      throw new UserError("Folder not found.");
    }

    const newFolder = rawNewFolder.trim() ? folderName.parse(rawNewFolder) : "";

    const created = await db.$transaction(
      async (tx) => {
        // "Put them all in one folder" with a new name: make it (or reuse one so named) inside the chosen folder.
        if (newFolder) {
          const same = await tx.folder.findFirst({ where: { projectId, parentId: targetFolderId, name: { equals: newFolder, mode: "insensitive" } } });
          targetFolderId = (same ?? (await tx.folder.create({ data: { projectId, parentId: targetFolderId, name: newFolder } }))).id;
        }
        const folders = await tx.folder.findMany({ where: { projectId } });
        const pathNames = new Map<string | null, string>([[null, ""]]);
        const keyOf = (parentId: string | null, name: string) => `${parentId ?? ""}\u0000${name.toLowerCase()}`;
        const byParentAndName = new Map(folders.map((f) => [keyOf(f.parentId, f.name), f]));
        const byId = new Map(folders.map((f) => [f.id, f]));
        const fullPath = (id: string | null): string => {
          if (!id) return "";
          if (pathNames.has(id)) return pathNames.get(id)!;
          const f = byId.get(id)!;
          const p = [fullPath(f.parentId), f.name].filter(Boolean).join(" / ");
          pathNames.set(id, p);
          return p;
        };

        const ensurePath = async (path: string[]) => {
          let parentId = targetFolderId;
          for (const name of path) {
            let folder = byParentAndName.get(keyOf(parentId, name));
            if (!folder) {
              folder = await tx.folder.create({ data: { projectId, parentId, name } });
              byParentAndName.set(keyOf(parentId, name), folder);
              byId.set(folder.id, folder);
            }
            parentId = folder.id;
          }
          return parentId;
        };

        const { caseSeq } = await tx.project.update({
          where: { id: projectId },
          data: { caseSeq: { increment: cases.length } },
        });
        let number = caseSeq - cases.length;
        const author = { authorId: user.id, authorName: user.name ?? user.email };

        const sharedIds = new Map<string, string>();
        if (sharedDefs.length) {
          const existing = await tx.sharedStep.findMany({
            where: { projectId, archived: false, name: { in: sharedDefs.map((d) => d.name) } },
            include: { versions: { orderBy: { version: "desc" }, take: 1 } },
          });
          for (const d of sharedDefs) {
            const same = existing.find((e) => e.name === d.name && JSON.stringify(e.versions[0]?.steps) === JSON.stringify(d.steps));
            const id =
              same?.id ??
              (
                await tx.sharedStep.create({
                  data: {
                    projectId,
                    name: d.name,
                    versions: { create: { version: 1, name: d.name, parameters: [], steps: d.steps as Prisma.InputJsonValue, ...author } },
                  },
                })
              ).id;
            sharedIds.set(d.key, id);
          }
        }

        // "[WEB] - Sign in" comes in as the tag Web and the title "Sign in".
        const platformNames = await knownTagNamesFor(projectId);
        const areaCtx = await areaContextFor(projectId);
        areaCtx.known.push(...area.words);
        for (const raw of cases) {
          const split = splitBracketTitle(raw.title, { platforms: platformNames });
          // With no platforms, only the [bracket] tag leads, as in the preview.
          const lead = areaCtx.platforms.length ? normalizeTags([...split.tags, ...raw.tags]) : split.tags;
          const withArea = applyAreaWord(split.title, lead, area.words, areaCtx);
          const c = { ...raw, title: withArea?.title ?? split.title };
          number += 1;
          const folderId = await ensurePath(c.folderPath);
          const tags = normalizeTags([...(withArea?.tags ?? split.tags), ...c.tags]);
          const steps = (c.items ?? c.steps.map((s) => ({ kind: "step" as const, ...s }))).map((item) => {
            if (item.kind === "step") return { kind: "step" as const, action: item.action, expected: item.expected };
            const sharedStepId = sharedIds.get(item.key);
            if (!sharedStepId) throw new UserError("A shared step in the file is missing. Load the file again.");
            return { kind: "shared" as const, sharedStepId, params: {} };
          });
          await tx.testCase.create({
            data: {
              projectId,
              number,
              folderId,
              title: c.title,
              preconditions: c.preconditions,
              priority: c.priority,
              type: c.type,
              automationId: c.automationId,
              sourceKey: c.sourceId || null,
              runBefore,
              tags,
              jiraStories: c.stories,
              sharedUsages: { create: sharedStepIdsIn(steps).map((sharedStepId) => ({ sharedStepId })) },
              versions: {
                create: {
                  version: 1,
                  title: c.title,
                  preconditions: c.preconditions,
                  priority: c.priority,
                  type: c.type,
                  automationId: c.automationId,
                  tags,
                  folderPath: fullPath(folderId),
                  steps: steps as Prisma.InputJsonValue,
                  changeNote: `Imported from ${fileName.slice(0, 200)}`,
                  ...author,
                },
              },
            },
          });
        }
        return cases.length;
      },
      { timeout: 120_000 },
    );

    if (area.skip.length) {
      const p = await db.project.findUnique({ where: { id: projectId }, select: { areaSkip: true } });
      const all = [...(p?.areaSkip ?? [])];
      for (const w of area.skip) if (!all.some((x) => x.toLowerCase() === w.toLowerCase())) all.push(w);
      await db.project.update({ where: { id: projectId }, data: { areaSkip: all.slice(-500) } });
    }
    revalidatePath(`/p/${project.key}`, "layout");
    return { created, shared: sharedDefs.length, folderId: targetFolderId };
  });
}
