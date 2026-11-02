"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { applyAreaWord, findAreaWords } from "@/lib/area-tags";
import { db } from "@/lib/db";
import { normalizeTags } from "@/lib/format";
import { requireProjectAction } from "@/lib/session";
import { areaContextFor, knownTagNamesFor } from "@/lib/tag-data";
import { parseTagColors, splitBracketTitle, TAG_COLORS } from "@/lib/tags";
import { attempt, UserError } from "./result";

// Bracket tags: tag colors, renaming a tag everywhere, and turning existing
// "[WEB] - …" titles into tags (with Undo), and area words after the platform.

type Author = { authorId: string; authorName: string };

/** Give one case a new title and tags as a new version, so the old title stays in History. */
async function retitle(caseId: string, projectId: string, title: string, tags: string[], changeNote: string, author: Author) {
  const c = await db.testCase.findFirst({ where: { id: caseId, projectId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!c) return null;
  const v = c.versions[0];
  await db.$transaction([
    ...(v
      ? [
          db.caseVersion.create({
            data: { caseId: c.id, version: c.currentVersion + 1, title, preconditions: v.preconditions, priority: v.priority, type: v.type, automationId: v.automationId, tags, folderPath: v.folderPath, steps: v.steps as Prisma.InputJsonValue, charter: v.charter ?? Prisma.DbNull, testData: v.testData ?? Prisma.DbNull, personaName: v.personaName, changeNote, ...author },
          }),
        ]
      : []),
    db.testCase.update({ where: { id: c.id }, data: { title, tags, ...(v ? { currentVersion: c.currentVersion + 1 } : {}) } }),
  ]);
  return c;
}

/** Right-click a tag → color. Saved on the library, so everyone sees the same color. */
export async function setTagColor(projectId: string, tag: string, color: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "case:edit");
    if (!TAG_COLORS.includes(color)) throw new UserError("Pick one of the swatches.");
    const colors = { ...parseTagColors(project.tagColors), [tag.toLowerCase()]: color };
    await db.project.update({ where: { id: projectId }, data: { tagColors: colors } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

/** Right-click a tag → Rename everywhere: every case in this library that has it. */
export async function renameTag(projectId: string, from: string, to: string) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const name = to.trim().replace(/^\[(.*)\]$/, "$1").trim();
    if (!name || name.length > 24) throw new UserError("Use 1 to 24 characters.");
    const cases = await db.testCase.findMany({ where: { projectId, tags: { has: from } }, select: { id: true, tags: true } });
    await db.$transaction(cases.map((c) => db.testCase.update({ where: { id: c.id }, data: { tags: normalizeTags(c.tags.map((t) => (t === from ? name : t))) } })));
    const colors = parseTagColors(project.tagColors);
    if (colors[from.toLowerCase()] && !colors[name.toLowerCase()]) {
      colors[name.toLowerCase()] = colors[from.toLowerCase()];
      delete colors[from.toLowerCase()];
      await db.project.update({ where: { id: projectId }, data: { tagColors: colors } });
    }
    await logActivity({ actor: user, kind: "settings", action: `Renamed the tag ${from} to ${name}`, project, detail: `${cases.length} cases` });
    revalidatePath(`/p/${project.key}`, "layout");
    return { count: cases.length };
  });
}

/** What converting would do: counts per tag and an example, for the review box. */
export async function previewBracketTitles(projectId: string, opts: { dropDash: boolean; matchPlatforms: boolean }) {
  return attempt(async () => {
    await requireProjectAction(projectId, "case:edit");
    const platforms = await knownTagNamesFor(projectId, { platforms: opts.matchPlatforms });
    const cases = await db.testCase.findMany({ where: { projectId, archived: false, title: { startsWith: "[" } }, select: { id: true, title: true }, orderBy: { number: "asc" } });
    const counts = new Map<string, number>();
    let example: { before: string; after: string; tags: string[] } | null = null;
    let n = 0;
    for (const c of cases) {
      const s = splitBracketTitle(c.title, { platforms, keepDash: !opts.dropDash });
      if (!s.tags.length) continue;
      n++;
      example ??= { before: c.title, after: s.title, tags: s.tags };
      for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return { count: n, tags: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })), example };
  });
}

/**
 * Turn every "[WEB] - Title" in this library into the tag and the title. Each case gets a
 * new version, so its original title stays in History. Returns what Undo needs.
 */
export async function convertBracketTitles(projectId: string, opts: { dropDash: boolean; matchPlatforms: boolean }) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const platforms = await knownTagNamesFor(projectId, { platforms: opts.matchPlatforms });
    const cases = await db.testCase.findMany({ where: { projectId, archived: false, title: { startsWith: "[" } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    const undo: { id: string; title: string; tags: string[] }[] = [];
    const author = { authorId: user.id, authorName: user.name ?? user.email };
    for (const c of cases) {
      const s = splitBracketTitle(c.title, { platforms, keepDash: !opts.dropDash });
      if (!s.tags.length) continue;
      const tags = normalizeTags([...s.tags, ...c.tags]);
      const v = c.versions[0];
      await db.$transaction([
        ...(v
          ? [
              db.caseVersion.create({
                data: { caseId: c.id, version: c.currentVersion + 1, title: s.title, preconditions: v.preconditions, priority: v.priority, type: v.type, automationId: v.automationId, tags, folderPath: v.folderPath, steps: v.steps as Prisma.InputJsonValue, charter: v.charter ?? Prisma.DbNull, testData: v.testData ?? Prisma.DbNull, personaName: v.personaName, changeNote: "Brackets turned into tags", ...author },
              }),
            ]
          : []),
        db.testCase.update({ where: { id: c.id }, data: { title: s.title, tags, ...(v ? { currentVersion: c.currentVersion + 1 } : {}) } }),
      ]);
      undo.push({ id: c.id, title: c.title, tags: c.tags });
    }
    await logActivity({ actor: user, kind: "settings", action: "Turned bracket titles into tags", project, detail: `${undo.length} cases` });
    revalidatePath(`/p/${project.key}`, "layout");
    return { count: undo.length, undo };
  });
}

/** Undo puts every title and tag list back exactly as it was (with another version in History). */
export async function undoBracketTitles(projectId: string, undo: { id: string; title: string; tags: string[] }[]) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const author = { authorId: user.id, authorName: user.name ?? user.email };
    for (const u of undo.slice(0, 5000)) {
      const c = await db.testCase.findFirst({ where: { id: u.id, projectId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      if (!c) continue;
      const v = c.versions[0];
      await db.$transaction([
        ...(v
          ? [
              db.caseVersion.create({
                data: { caseId: c.id, version: c.currentVersion + 1, title: u.title, preconditions: v.preconditions, priority: v.priority, type: v.type, automationId: v.automationId, tags: u.tags, folderPath: v.folderPath, steps: v.steps as Prisma.InputJsonValue, charter: v.charter ?? Prisma.DbNull, testData: v.testData ?? Prisma.DbNull, personaName: v.personaName, changeNote: "Undid brackets turned into tags", ...author },
              }),
            ]
          : []),
        db.testCase.update({ where: { id: c.id }, data: { title: u.title, tags: u.tags, ...(v ? { currentVersion: c.currentVersion + 1 } : {}) } }),
      ]);
    }
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

// Area tags: the word after the platform ("Unity · Hub - Space List").

const areaCases = (projectId: string) => db.testCase.findMany({ where: { projectId, archived: false }, select: { id: true, title: true, tags: true }, orderBy: { number: "asc" } });

/** Area words in this library, for the review box: count, whether it's already a tag, and an example. */
export async function previewAreaTitles(projectId: string) {
  return attempt(async () => {
    await requireProjectAction(projectId, "case:edit");
    const [ctx, cases] = await Promise.all([areaContextFor(projectId), areaCases(projectId)]);
    return { words: findAreaWords(cases, ctx) };
  });
}

/**
 * Turn the ticked area words into tags. Unticked ones (`skip`) are remembered so they
 * aren't offered again. Each case gets a new version; returns what Undo needs.
 */
export async function convertAreaTitles(projectId: string, words: string[], skip: string[]) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const pick = z.array(z.string().trim().min(1).max(24)).max(500);
    const take = pick.parse(words);
    const no = pick.parse(skip);
    if (no.length) await rememberSkips(projectId, no);
    const [ctx, cases] = await Promise.all([areaContextFor(projectId), areaCases(projectId)]);
    const author = { authorId: user.id, authorName: user.name ?? user.email };
    const undo: { id: string; title: string; tags: string[] }[] = [];
    for (const c of cases) {
      const a = applyAreaWord(c.title, c.tags, take, ctx);
      if (!a) continue;
      await retitle(c.id, projectId, a.title, normalizeTags(a.tags), "Area word turned into a tag", author);
      undo.push({ id: c.id, title: c.title, tags: c.tags });
    }
    await logActivity({ actor: user, kind: "settings", action: "Turned area words into tags", project, detail: `${undo.length} cases: ${take.join(", ")}` });
    revalidatePath(`/p/${project.key}`, "layout");
    return { count: undo.length, undo };
  });
}

/** Undo for area tags: every title and tag list back as it was (with another version in History). */
export async function undoAreaTitles(projectId: string, undo: { id: string; title: string; tags: string[] }[]) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "case:edit");
    const author = { authorId: user.id, authorName: user.name ?? user.email };
    for (const u of undo.slice(0, 5000)) await retitle(u.id, projectId, u.title, u.tags, "Undid area word turned into a tag", author);
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

/** "No" to an area word in the title box or import: don't offer it again in this library. */
export async function skipAreaWord(projectId: string, word: string) {
  return attempt(async () => {
    await requireProjectAction(projectId, "case:edit");
    await rememberSkips(projectId, [z.string().trim().min(1).max(24).parse(word)]);
    return {};
  });
}

async function rememberSkips(projectId: string, words: string[]) {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { areaSkip: true } });
  const all = [...(p?.areaSkip ?? [])];
  for (const w of words) if (!all.some((x) => x.toLowerCase() === w.toLowerCase())) all.push(w);
  await db.project.update({ where: { id: projectId }, data: { areaSkip: all.slice(-500) } });
}
