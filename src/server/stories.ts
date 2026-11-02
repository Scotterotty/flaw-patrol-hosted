"use server";

import { logActivity } from "@/lib/activity";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { jiraFor, JiraError } from "@/lib/jira";
import { requireProjectAction } from "@/lib/session";
import { storiesConfigFor } from "@/lib/stories";
import { libraryProjectIds } from "@/lib/umbrella";
import { attempt, UserError } from "./result";

// Requirements (ver_82 as "stories", renamed in ver_89): link cases to the Jira issues they test. Only the key is stored.

const keySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}-\d+$/, "That isn't a Jira key like PRJ-12.");

/** Live search for stories to link, by key or words. */
export async function searchStories(projectId: string, q: string) {
  return attempt(async () => {
    await requireProjectAction(projectId, "case:edit");
    const setup = await storiesConfigFor(projectId);
    if (!setup) throw new UserError("Connect Jira in Settings first, then requirements can be linked.");
    const client = await jiraFor(projectId);
    try {
      const issues = await client!.searchStories(setup.config, z.string().max(200).parse(q));
      return { issues: issues.map((i) => ({ key: i.key, title: i.summary, status: i.status, url: i.url, type: i.type })) };
    } catch (e) {
      throw new UserError(e instanceof JiraError ? e.message : "Couldn't search Jira.");
    }
  });
}

/** Add a story to cases (skipping cases that have it) or take it off them. Not a new case version. */
export async function linkStory(projectId: string, caseIds: string[], storyKey: string, mode: "add" | "remove" = "add") {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "case:edit");
    const key = keySchema.parse(storyKey);
    const ids = z.array(z.string().max(40)).min(1, "Tick at least one case.").max(5000).parse(caseIds);
    const library = await libraryProjectIds(project);
    const cases = await db.testCase.findMany({ where: { id: { in: ids }, projectId: { in: library } }, select: { id: true, jiraStories: true, project: { select: { key: true } } } });
    let changed = 0;
    for (const c of cases) {
      const has = c.jiraStories.includes(key);
      if (mode === "add" ? has : !has) continue;
      await db.testCase.update({ where: { id: c.id }, data: { jiraStories: mode === "add" ? [...c.jiraStories, key] : c.jiraStories.filter((k) => k !== key) } });
      changed++;
    }
    for (const k of new Set([project.key, ...cases.map((c) => c.project.key)])) revalidatePath(`/p/${k}`, "layout");
    return { changed, skipped: cases.length - changed };
  });
}

const configSchema = z.object({
  project: z.string().trim().max(30).default(""),
  types: z.array(z.string().trim().min(1).max(60)).min(1, "Tick at least one issue type.").max(30),
  linkBugs: z.boolean().default(true),
  rollUp: z.boolean().default(false),
});

/** Settings › Jira › Requirements: where requirements live and which issue types count. */
export async function saveStoriesConfig(projectId: string, input: z.input<typeof configSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const data = configSchema.parse(input);
    const row = await db.jiraConfig.findUnique({ where: { projectId } });
    if (!row) throw new UserError("Connect Jira first.");
    await db.jiraConfig.update({ where: { projectId }, data: { stories: { ...data, project: data.project === "*" ? "*" : data.project.toUpperCase() } as Prisma.InputJsonValue } });
    revalidatePath(`/p/${project.key}`, "layout");
    if (project.groupId) revalidatePath(`/g/${project.groupId}`, "layout");
    await logActivity({ actor: user, kind: "settings", action: "Changed Requirements settings", project });
    return {};
  });
}

/** Settings › Jira › Requirements: the issue types the requirement project has in Jira. */
export async function loadIssueTypes(projectId: string, project: string) {
  return attempt(async () => {
    await requireProjectAction(projectId, "jira:manage");
    const setup = await storiesConfigFor(projectId);
    if (!setup) throw new UserError("Connect Jira first.");
    const key = z.string().trim().max(30).parse(project).toUpperCase() || setup.bugProject;
    try {
      const client = await jiraFor(projectId);
      return { types: await client!.issueTypes(key === "*" ? "*" : key), project: key };
    } catch (e) {
      throw new UserError(e instanceof JiraError ? e.message : "Couldn't load issue types from Jira.");
    }
  });
}

/** Import preview: which story keys from the file Jira doesn't know. */
export async function checkStoryKeys(projectId: string, keys: string[]) {
  return attempt(async () => {
    await requireProjectAction(projectId, "import");
    const list = z.array(keySchema).max(2000).parse(keys);
    if (!list.length || !(await storiesConfigFor(projectId))) return { unknown: [] as string[], checked: false };
    const client = await jiraFor(projectId);
    try {
      const found = new Set<string>();
      for (let i = 0; i < list.length; i += 100) for (const issue of await client!.getMany(list.slice(i, i + 100))) found.add(issue.key.toUpperCase());
      return { unknown: list.filter((k) => !found.has(k)), checked: true };
    } catch {
      return { unknown: [] as string[], checked: false };
    }
  });
}
