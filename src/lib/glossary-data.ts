import "server-only";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "./db";
import { badgeOf } from "./game";
import { type GlossaryLite, type GlossaryRights } from "./glossary";
import { can } from "./permissions";
import { roleRulesFor } from "./session";
import { NOT_PRACTICE } from "@/lib/practice";

type Viewer = { id: string; isAdmin: boolean };

/**
 * What this person may do in the Glossary. It's one list for the whole team, so their best
 * role anywhere counts: editing follows the "Add and edit Glossary terms" row of each
 * umbrella's What can they do, and deleting other people's terms is for Admins.
 */
export const glossaryRights = cache(async (user: Viewer): Promise<GlossaryRights> => {
  if (user.isAdmin) return { edit: true, deleteAny: true };
  const memberships = await db.projectMember.findMany({ where: { userId: user.id, project: NOT_PRACTICE }, select: { role: true, project: { select: { id: true, groupId: true, roleRules: true } } } });
  let edit = false;
  let deleteAny = false;
  for (const m of memberships) {
    if (m.role === "ADMIN") deleteAny = true;
    if (!edit && can({ role: m.role, rules: await roleRulesFor(m.project) }, "glossary:edit")) edit = true;
  }
  return { edit: edit || deleteAny, deleteAny };
});

/** Every answered term, small, for underlines and Look it up on every page. */
export async function glossaryLite(): Promise<GlossaryLite[]> {
  return db.glossaryTerm.findMany({ select: { id: true, term: true, slug: true, aliases: true, meaning: true }, orderBy: { term: "asc" }, take: 3000 });
}

/** For the left menu: how many terms, and a dot when a question you asked got answered. */
export const glossaryMenu = cache(async (userId: string) => {
  const [count, unseen] = await Promise.all([
    db.glossaryTerm.count(),
    db.glossaryTerm.count({ where: { createdById: userId, answerUnseen: true } }),
  ]);
  return { count, unseen: unseen > 0 };
});

/** Projects whose cases and bugs this person can see, for "Used in". */
async function visibleProjectIds(user: Viewer) {
  if (user.isAdmin) return (await db.project.findMany({ where: { archivedAt: null, ...NOT_PRACTICE }, select: { id: true } })).map((p) => p.id);
  return (await db.projectMember.findMany({ where: { userId: user.id, project: { archivedAt: null, ...NOT_PRACTICE } }, select: { projectId: true } })).map((m) => m.projectId);
}

/** A term's names as one Postgres word-boundary pattern: \m(rc|release candidate)\M. */
function wordPattern(t: { term: string; aliases: string[] }) {
  const esc = (s: string) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return `\\m(${[t.term, ...t.aliases].filter((n) => n.trim().length >= 2).map(esc).join("|")})\\M`;
}

/** How many cases and bugs mention each term, among the ones this person can see. */
async function usedCounts(user: Viewer, terms: { id: string; term: string; aliases: string[] }[]) {
  const out = new Map<string, number>();
  const ids = await visibleProjectIds(user);
  if (!terms.length || !ids.length) return out;
  const termIds = terms.map((t) => t.id);
  const pats = terms.map(wordPattern);
  const rows = await db.$queryRaw<{ id: string; n: bigint }[]>`
    WITH t AS (SELECT * FROM unnest(${termIds}::text[], ${pats}::text[]) AS x(id, pat))
    SELECT t.id, (
      (SELECT count(*) FROM "TestCase" c JOIN "CaseVersion" v ON v."caseId" = c.id AND v.version = c."currentVersion"
        WHERE c."projectId" IN (${Prisma.join(ids)}) AND c.archived = false AND (c.title ~* t.pat OR v.steps::text ~* t.pat))
      + (SELECT count(*) FROM "Defect" d WHERE d."projectId" IN (${Prisma.join(ids)}) AND (d.title ~* t.pat OR d.description ~* t.pat))
    ) AS n
    FROM t`;
  for (const r of rows) out.set(r.id, Number(r.n));
  return out;
}

/** The cases and bugs that mention one term, for the Used in list. */
export async function termUses(user: Viewer, term: { term: string; aliases: string[] }) {
  const ids = await visibleProjectIds(user);
  if (!ids.length) return [];
  const pat = wordPattern(term);
  const [cases, bugs] = await Promise.all([
    db.$queryRaw<{ title: string; number: number; key: string }[]>`
      SELECT c.title, c.number, p.key FROM "TestCase" c
      JOIN "CaseVersion" v ON v."caseId" = c.id AND v.version = c."currentVersion"
      JOIN "Project" p ON p.id = c."projectId"
      WHERE c."projectId" IN (${Prisma.join(ids)}) AND c.archived = false AND (c.title ~* ${pat} OR v.steps::text ~* ${pat})
      ORDER BY c."updatedAt" DESC LIMIT 30`,
    db.$queryRaw<{ title: string; number: number; key: string; externalKey: string | null; groupId: string | null }[]>`
      SELECT d.title, d.number, p.key, d."externalKey", coalesce(p."groupId", g.id) AS "groupId" FROM "Defect" d JOIN "Project" p ON p.id = d."projectId"
      LEFT JOIN "ProjectGroup" g ON g."hubProjectId" = p.id
      WHERE d."projectId" IN (${Prisma.join(ids)}) AND (d.title ~* ${pat} OR d.description ~* ${pat})
      ORDER BY d."createdAt" DESC LIMIT 20`,
  ]);
  return [
    ...cases.map((c) => ({ kind: "Case" as const, label: `${c.key}-${c.number} ${c.title}`, href: `/p/${c.key}/cases/${c.number}` })),
    ...bugs.map((b) => ({ kind: "Bug" as const, label: `${b.externalKey ?? `D-${b.number}`} ${b.title}`, href: b.groupId ? `/g/${b.groupId}/bugs?all=1&q=${encodeURIComponent(b.externalKey ?? b.title)}` : `/p/${b.key}/bugs#D-${b.number}` })),
  ];
}

export type GlossaryPerson = { id: string; name: string | null; email: string; avatarAt: Date | null; title: string | null; frame: string | null };

export type GlossaryRow = {
  id: string;
  term: string;
  slug: string;
  aliases: string[];
  meaning: string;
  question: string;
  groupId: string | null;
  foundLabel: string;
  foundUrl: string;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  createdBy: GlossaryPerson | null;
  answeredBy: GlossaryPerson | null;
  updatedBy: GlossaryPerson | null;
  edits: number;
  used: number;
};

/** Everything the Glossary page shows. Opening it also clears your "answered" dot. */
export async function glossaryPage(user: Viewer) {
  const [terms, groups] = await Promise.all([
    db.glossaryTerm.findMany({ orderBy: { term: "asc" }, include: { _count: { select: { versions: true } } } }),
    db.projectGroup.findMany({ where: { hubProjectId: { not: null }, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const peopleIds = [...new Set(terms.flatMap((t) => [t.createdById, t.answeredById, t.updatedById]).filter((x): x is string => !!x))];
  const people = new Map(
    (await db.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true, email: true, avatarAt: true, gameEnabled: true, gameTitle: true, gameFrame: true } })).map((p) => {
      const b = badgeOf(p);
      return [p.id, { id: p.id, name: p.name, email: p.email, avatarAt: p.avatarAt, title: b.title, frame: b.frame }];
    }),
  );
  const used = await usedCounts(user, terms.filter((t) => t.meaning));
  const rows: GlossaryRow[] = terms.map((t) => ({
    id: t.id,
    term: t.term,
    slug: t.slug,
    aliases: t.aliases,
    meaning: t.meaning,
    question: t.question,
    groupId: t.groupId,
    foundLabel: t.foundLabel,
    foundUrl: t.foundUrl,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    answeredAt: t.answeredAt?.toISOString() ?? null,
    createdBy: (t.createdById && people.get(t.createdById)) || null,
    answeredBy: (t.answeredById && people.get(t.answeredById)) || null,
    updatedBy: (t.updatedById && people.get(t.updatedById)) || null,
    // The first version is the term being added; edits are the ones after.
    edits: Math.max(0, t._count.versions - 1),
    used: used.get(t.id) ?? 0,
  }));
  const answeredForMe = terms.filter((t) => t.createdById === user.id && t.answerUnseen).map((t) => t.id);
  if (answeredForMe.length) await db.glossaryTerm.updateMany({ where: { id: { in: answeredForMe } }, data: { answerUnseen: false } });
  return { rows, groups, answeredForMe };
}

/**
 * Glossary work that counts for the mini game, for one person (src/lib/xp.ts) or for
 * crowns (src/lib/crowns.ts). A term counts for whoever wrote its meaning: the person who
 * added it, or whoever answered someone else's question.
 */
export async function glossaryWork(where: Prisma.GlossaryTermWhereInput = {}) {
  return db.glossaryTerm.findMany({
    where: { ...where, meaning: { not: "" } },
    select: { id: true, meaning: true, createdById: true, answeredById: true, createdAt: true, answeredAt: true, lookups: { select: { userId: true } } },
  });
}
