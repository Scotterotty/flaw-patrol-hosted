"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";
import { saveCase } from "./cases";

// New cases from a requirement (ver_96): the Requirements page's Cases for KEY box writes
// new cases or a charter that come out already linked to the requirement.

const keySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]*-\d+$/, "That isn't a Jira key.");

/** The folder picked, or "new": a folder named after the requirement at the top of the library. */
async function folderFor(projectId: string, folder: string | null, storyKey: string) {
  if (folder !== "new") return folder;
  const found = await db.folder.findFirst({ where: { projectId, parentId: null, name: storyKey }, select: { id: true } });
  if (found) return found.id;
  return (await db.folder.create({ data: { projectId, name: storyKey }, select: { id: true } })).id;
}

async function linkAndFlag(projectId: string, numbers: number[], storyKey: string, flaggedBy: string | null) {
  const made = await db.testCase.findMany({ where: { projectId, number: { in: numbers } }, select: { id: true, number: true } });
  for (const c of made)
    await db.testCase.update({
      where: { id: c.id },
      data: {
        jiraStories: { push: storyKey },
        // Titles only: flagged Needs steps until a step is written.
        ...(flaggedBy && { flag: "NEEDS_STEPS", flagNote: `Made from ${storyKey} with a title only.`, flaggedBy, flaggedAt: new Date() }),
      },
    });
  return numbers.map((n) => made.find((c) => c.number === n)!).filter(Boolean);
}

const casesSchema = z.object({
  titles: z.array(z.string().trim().max(500)).max(50).transform((l) => l.filter(Boolean)).refine((l) => l.length > 0, "Type at least one title."),
  folder: z.string().max(40).nullable(),
});

/** + New case: one case per title, linked to the requirement, flagged Needs steps. */
export async function createCasesForStory(projectId: string, storyKey: string, input: z.input<typeof casesSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const key = keySchema.parse(storyKey);
    const data = casesSchema.parse(input);
    const folderId = await folderFor(projectId, data.folder, key);
    const numbers: number[] = [];
    for (const title of data.titles) {
      const r = await saveCase(projectId, null, { title, priority: "MEDIUM", type: "MANUAL", folderId, steps: [], changeNote: `Created from ${key}` });
      if (!r.ok) throw new UserError(r.error);
      numbers.push(r.number);
    }
    await linkAndFlag(projectId, numbers, key, user.name ?? user.email);
    revalidatePath(`/p/${project.key}`, "layout");
    return { key: project.key, numbers };
  });
}

const charterSchema = z.object({
  explore: z.string().trim().min(1, "Say what to explore.").max(2000),
  with: z.string().trim().max(2000).default(""),
  discover: z.string().trim().max(2000).default(""),
  minutes: z.number().int().min(5).max(480),
  folder: z.string().max(40).nullable(),
});

/** + New charter: an exploring charter linked to the requirement. */
export async function createCharterForStory(projectId: string, storyKey: string, input: z.input<typeof charterSchema>) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "case:edit");
    const key = keySchema.parse(storyKey);
    const data = charterSchema.parse(input);
    const folderId = await folderFor(projectId, data.folder, key);
    const r = await saveCase(projectId, null, {
      title: `Explore: ${data.explore}`.slice(0, 500),
      priority: "MEDIUM",
      type: "EXPLORATORY",
      folderId,
      steps: [],
      charter: { explore: data.explore, with: data.with, discover: data.discover, minutes: data.minutes, reminders: [], prompts: [] },
      changeNote: `Created from ${key}`,
    });
    if (!r.ok) throw new UserError(r.error);
    const [made] = await linkAndFlag(projectId, [r.number], key, null);
    revalidatePath(`/p/${project.key}`, "layout");
    return { key: project.key, number: r.number, caseId: made.id };
  });
}
