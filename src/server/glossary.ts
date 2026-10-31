"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { refreshCrowns } from "@/lib/crowns";
import { db } from "@/lib/db";
import { MEANING_MAX, TERM_MAX, findTerm, parseAliases, slugOf, termKey, type GlossaryLite } from "@/lib/glossary";
import { glossaryLite, glossaryRights, termUses } from "@/lib/glossary-data";
import { Forbidden, requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";

const termText = z.string().trim().min(1, "Type the term.").max(TERM_MAX, `Keep the term under ${TERM_MAX} characters.`);
const foundSchema = { foundLabel: z.string().trim().max(200).default(""), foundUrl: z.string().trim().max(500).default("") };
const addSchema = z.object({
  term: termText,
  aliases: z.string().max(1000).default(""),
  meaning: z.string().trim().min(1, "Write what it means, or pick Ask the team instead.").max(MEANING_MAX),
  groupId: z.string().max(40).nullable().default(null),
  ...foundSchema,
});
const askSchema = z.object({ term: termText, question: z.string().trim().max(MEANING_MAX).default(""), ...foundSchema });
const editSchema = z.object({
  term: termText,
  aliases: z.string().max(1000).default(""),
  meaning: z.string().trim().max(MEANING_MAX).default(""),
  groupId: z.string().max(40).nullable().default(null),
});

/** Only a found-on link inside Flaw Patrol is kept, so a term can't send people elsewhere. */
const safeUrl = (u: string) => (u.startsWith("/") && !u.startsWith("//") ? u : "");

async function editor() {
  const user = await requireUser();
  const rights = await glossaryRights(user);
  if (!rights.edit) throw new Forbidden("Viewers can ask the team, but not add or edit Glossary terms.");
  return { user, rights };
}

/** The term or one of its other names is already in the Glossary. */
async function existing(term: string, aliases: string[], notId?: string) {
  const all = await db.glossaryTerm.findMany({ where: notId ? { id: { not: notId } } : {}, select: { id: true, term: true, aliases: true, slug: true } });
  for (const name of [term, ...aliases]) {
    const hit = findTerm(all, name);
    if (hit) return { hit, name };
  }
  return null;
}

async function freeSlug(term: string, notId?: string) {
  const base = slugOf(term);
  for (let n = 1; n < 200; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await db.glossaryTerm.findFirst({ where: { slug, ...(notId ? { id: { not: notId } } : {}) }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now()}`;
}

async function validGroup(groupId: string | null) {
  if (!groupId) return null;
  const g = await db.projectGroup.findFirst({ where: { id: groupId, hubProjectId: { not: null } }, select: { id: true } });
  return g?.id ?? null;
}

/** Glossary work counts toward Keeper of Words in every umbrella. Never breaks the save. */
async function afterChange() {
  revalidatePath("/", "layout");
  try {
    const groups = await db.projectGroup.findMany({ where: { hubProjectId: { not: null }, archivedAt: null }, select: { id: true } });
    for (const g of groups) await refreshCrowns(g.id);
  } catch (e) {
    console.error("Crowns: counting failed", e);
  }
}

const already = (name: string, hit: { term: string }) =>
  termKey(hit.term) === termKey(name) ? `"${hit.term}" is already in the Glossary.` : `"${name}" is already in the Glossary, as another name for "${hit.term}".`;

/** Add a term with its meaning. */
export async function addGlossaryTerm(input: z.input<typeof addSchema>) {
  return attempt(async () => {
    const { user } = await editor();
    const d = addSchema.parse(input);
    const aliases = parseAliases(d.aliases, d.term);
    const dup = await existing(d.term, aliases);
    if (dup) throw new UserError(already(dup.name, dup.hit));
    const groupId = await validGroup(d.groupId);
    const t = await db.glossaryTerm.create({
      data: {
        term: d.term,
        key: termKey(d.term),
        slug: await freeSlug(d.term),
        aliases,
        meaning: d.meaning,
        groupId,
        foundLabel: d.foundLabel,
        foundUrl: safeUrl(d.foundUrl),
        createdById: user.id,
        updatedById: user.id,
        versions: { create: { term: d.term, aliases, meaning: d.meaning, groupId, byId: user.id, note: "Added" } },
      },
    });
    await afterChange();
    return { id: t.id, slug: t.slug };
  });
}

/** Ask the team: the term goes in with your question and no meaning yet. Viewers can too. */
export async function askGlossaryTerm(input: z.input<typeof askSchema>) {
  return attempt(async () => {
    const user = await requireUser();
    const d = askSchema.parse(input);
    const dup = await existing(d.term, []);
    if (dup) throw new UserError(already(dup.name, dup.hit));
    const t = await db.glossaryTerm.create({
      data: {
        term: d.term,
        key: termKey(d.term),
        slug: await freeSlug(d.term),
        question: d.question,
        foundLabel: d.foundLabel,
        foundUrl: safeUrl(d.foundUrl),
        createdById: user.id,
        updatedById: user.id,
        versions: { create: { term: d.term, byId: user.id, note: "Asked" } },
      },
    });
    revalidatePath("/", "layout");
    return { id: t.id, slug: t.slug };
  });
}

/**
 * Edit a term. Giving a question its first meaning answers it: the person who asked gets
 * a dot on Glossary in their menu until they open it.
 */
export async function editGlossaryTerm(id: string, input: z.input<typeof editSchema>) {
  return attempt(async () => {
    const { user } = await editor();
    const d = editSchema.parse(input);
    const old = await db.glossaryTerm.findUnique({ where: { id } });
    if (!old) throw new UserError("This term was deleted.");
    if (old.meaning && !d.meaning) throw new UserError("Write what it means. To take the term out, use Delete.");
    const aliases = parseAliases(d.aliases, d.term);
    const dup = await existing(d.term, aliases, id);
    if (dup) throw new UserError(already(dup.name, dup.hit));
    const groupId = await validGroup(d.groupId);
    const answering = !old.meaning && !!d.meaning;
    const same = old.term === d.term && old.meaning === d.meaning && old.groupId === groupId && old.aliases.join("\n") === aliases.join("\n");
    if (same) return { slug: old.slug };
    const renamed = termKey(old.term) !== termKey(d.term);
    const t = await db.glossaryTerm.update({
      where: { id },
      data: {
        term: d.term,
        key: termKey(d.term),
        ...(renamed ? { slug: await freeSlug(d.term, id) } : {}),
        aliases,
        meaning: d.meaning,
        groupId,
        updatedById: user.id,
        ...(answering ? { answeredById: user.id, answeredAt: new Date(), answerUnseen: old.createdById !== user.id } : {}),
        versions: { create: { term: d.term, aliases, meaning: d.meaning, groupId, byId: user.id, note: answering ? "Answered" : "Edited" } },
      },
    });
    if (answering) await afterChange();
    else revalidatePath("/", "layout");
    return { slug: t.slug };
  });
}

/** Admins can delete any term; everyone else only their own (a Viewer only their own question). */
export async function deleteGlossaryTerm(id: string) {
  return attempt(async () => {
    const user = await requireUser();
    const rights = await glossaryRights(user);
    const t = await db.glossaryTerm.findUnique({ where: { id }, select: { term: true, createdById: true } });
    if (!t) return {};
    if (!rights.deleteAny && t.createdById !== user.id) throw new Forbidden("Only Admins can delete terms other people added.");
    await db.glossaryTerm.delete({ where: { id } });
    await logActivity({ actor: user, kind: "delete", action: `Deleted Glossary term "${t.term}"` });
    await afterChange();
    return {};
  });
}

/** A term's saved versions, newest first, for History. */
export async function glossaryHistory(id: string) {
  return attempt(async () => {
    await requireUser();
    const versions = await db.glossaryVersion.findMany({ where: { termId: id }, orderBy: { createdAt: "desc" }, take: 50 });
    const people = new Map((await db.user.findMany({ where: { id: { in: versions.map((v) => v.byId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email]));
    return {
      versions: versions.map((v) => ({ id: v.id, term: v.term, aliases: v.aliases, meaning: v.meaning, note: v.note, by: (v.byId && people.get(v.byId)) || "Someone", at: v.createdAt.toISOString() })),
    };
  });
}

/** Put an older meaning back. It's saved as a new version, so nothing is lost. */
export async function restoreGlossaryVersion(versionId: string) {
  return attempt(async () => {
    const { user } = await editor();
    const v = await db.glossaryVersion.findUnique({ where: { id: versionId }, include: { glossary: true } });
    if (!v) throw new UserError("That version is gone.");
    if (!v.meaning) throw new UserError("That version has no meaning to put back.");
    const dup = await existing(v.term, v.aliases, v.termId);
    if (dup) throw new UserError(already(dup.name, dup.hit));
    await db.glossaryTerm.update({
      where: { id: v.termId },
      data: {
        term: v.term,
        key: termKey(v.term),
        aliases: v.aliases,
        meaning: v.meaning,
        groupId: await validGroup(v.groupId),
        updatedById: user.id,
        versions: { create: { term: v.term, aliases: v.aliases, meaning: v.meaning, groupId: v.groupId, byId: user.id, note: `Put back the version from ${v.createdAt.toISOString().slice(0, 10)}` } },
      },
    });
    revalidatePath("/", "layout");
    return {};
  });
}

/** The cases and bugs that mention a term. */
export async function glossaryUses(id: string) {
  return attempt(async () => {
    const user = await requireUser();
    const t = await db.glossaryTerm.findUnique({ where: { id }, select: { term: true, aliases: true } });
    if (!t) throw new UserError("This term was deleted.");
    return { uses: await termUses(user, t) };
  });
}

/** Someone opened a term's meaning (counted once per person), for Terms that helped and Bookworm. */
export async function glossaryLookedUp(id: string) {
  try {
    const user = await requireUser();
    await db.glossaryLookup.create({ data: { termId: id, userId: user.id } });
  } catch (e) {
    // Already counted, or the term is gone: nothing to do.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError)) console.error("Glossary lookup:", e);
  }
}

/** Every answered term, for underlines and Look it up, and what this person may do. */
export async function glossaryForPage(): Promise<{ terms: GlossaryLite[]; canEdit: boolean; groups: { id: string; name: string }[] }> {
  const user = await requireUser();
  const [terms, rights, groups] = await Promise.all([
    glossaryLite(),
    glossaryRights(user),
    db.projectGroup.findMany({
      where: { hubProjectId: { not: null }, archivedAt: null, ...(user.isAdmin ? {} : { projects: { some: { members: { some: { userId: user.id } } } } }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { terms, canEdit: rights.edit, groups };
}

/** Underline terms everywhere: on or off, for this person only. */
export async function setGlossaryUnderline(on: boolean) {
  return attempt(async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { glossaryUnderline: !!on } });
    revalidatePath("/", "layout");
    return {};
  });
}
