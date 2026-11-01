// The crowns code as it was before ver_129, kept only for npm run check:crowns, which compares
// it with src/lib/crowns.ts. Not used by the app.
import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parsePlatforms } from "@/lib/umbrella";
import { countsForXp } from "@/lib/glossary";
import { glossaryWork } from "@/lib/glossary-data";

//
// Mini game crowns (ver_96): titles held by whoever did the most of something in an
// umbrella over the last 30 days, like Foursquare mayors. Real work only, same as XP:
// no imported sheet results, automation, linked Jira issues or Won't fix bugs, and a
// case counts once per run. Only mini game players take part. Crowns give no XP.

export const CROWN_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
/** Folders with fewer cases than this get no crown. */
const FOLDER_MIN_CASES = 5;
/** Keeper of Words: Glossary terms needed before anyone can hold it. */
export const WORDS_NEED = 3;

export type CrownDef = {
  key: string;
  label: string;
  /** What's counted, for "You: 39 Web cases" lines. */
  unit: [one: string, many: string];
  /** What to do more of, for "10 more Unity cases to take it". */
  verb: string;
  /** The count needed before anyone can hold it. */
  need: number;
};

type Count = { n: number; first: number };

/** Every crown in an umbrella, with each player's count over the last 30 days. */
async function countCrowns(groupId: string): Promise<{ defs: CrownDef[]; counts: Map<string, Map<string, Count>> } | null> {
  const group = await db.projectGroup.findUnique({
    where: { id: groupId },
    select: { platforms: true, hubProjectId: true, archivedAt: true, projects: { select: { id: true, platform: true, archivedAt: true } } },
  });
  if (!group?.hubProjectId || group.archivedAt) return null;
  const since = new Date(Date.now() - CROWN_DAYS * DAY);
  const projectIds = group.projects.map((p) => p.id);
  const players = new Set((await db.user.findMany({ where: { gameEnabled: true, memberships: { some: { projectId: { in: projectIds } } } }, select: { id: true } })).map((u) => u.id));
  const defs: CrownDef[] = [];
  const counts = new Map<string, Map<string, Count>>();
  const add = (key: string, userId: string | null, at: Date) => {
    if (!userId || !players.has(userId)) return;
    const m = counts.get(key) ?? new Map<string, Count>();
    counts.set(key, m);
    const c = m.get(userId) ?? { n: 0, first: at.getTime() };
    c.n++;
    c.first = Math.min(c.first, at.getTime());
    m.set(userId, c);
  };

  // Cases given a verdict by hand, once per run and case (the latest result).
  const results = await db.testResult.findMany({
    where: {
      run: { projectId: { in: projectIds }, automated: false },
      createdAt: { gte: since },
      status: { in: ["PASSED", "FAILED", "BLOCKED"] },
      imported: false,
      automated: false,
      testerId: { in: [...players] },
      entry: { kind: { not: "EXPLORATORY" } },
    },
    select: { runId: true, caseId: true, testerId: true, createdAt: true, run: { select: { projectId: true } } },
    orderBy: { createdAt: "asc" },
  });
  const perRunCase = new Map<string, (typeof results)[number]>();
  for (const r of results) perRunCase.set(`${r.runId}:${r.caseId}`, r);
  const once = [...perRunCase.values()];

  // Ruler of {platform}: cases run in that platform's test cycles.
  const platformOf = new Map(group.projects.map((p) => [p.id, p.platform.toLowerCase()]));
  for (const p of parsePlatforms(group.platforms)) {
    const key = `platform:${p.name}`;
    defs.push({ key, label: p.crownName || `Ruler of ${p.name}`, unit: [`${p.name} case`, `${p.name} cases`], verb: `${p.name} cases`, need: 10 });
    for (const r of once) if (platformOf.get(r.run.projectId) === p.name.toLowerCase()) add(key, r.testerId, r.createdAt);
  }

  // Keeper of {folder}: cases run from each top-level folder of the Case library.
  const [folders, cases] = await Promise.all([
    db.folder.findMany({ where: { projectId: group.hubProjectId }, select: { id: true, parentId: true, name: true } }),
    db.testCase.findMany({ where: { projectId: group.hubProjectId, archived: false }, select: { id: true, folderId: true } }),
  ]);
  const parent = new Map(folders.map((f) => [f.id, f.parentId]));
  const top = (id: string | null) => {
    let cur = id;
    for (let i = 0; cur && parent.get(cur) && i < 50; i++) cur = parent.get(cur)!;
    return cur;
  };
  const caseTop = new Map(cases.map((c) => [c.id, top(c.folderId)]));
  const sizes = new Map<string, number>();
  for (const t of caseTop.values()) if (t) sizes.set(t, (sizes.get(t) ?? 0) + 1);
  for (const f of folders.filter((f) => !f.parentId && (sizes.get(f.id) ?? 0) >= FOLDER_MIN_CASES).sort((a, b) => a.name.localeCompare(b.name))) {
    const key = `folder:${f.id}`;
    defs.push({ key, label: `Keeper of ${f.name}`, unit: [`case from ${f.name}`, `cases from ${f.name}`], verb: `cases from the ${f.name} folder`, need: 10 });
    for (const r of once) if (caseTop.get(r.caseId) === f.id) add(key, r.testerId, r.createdAt);
  }

  // Bug Bash Champion, Trailblazer and Sharp Eye: one each per umbrella.
  defs.push({ key: "bash", label: "Bug Bash Champion", unit: ["bug in bug bashes", "bugs in bug bashes"], verb: "bugs in bug bashes", need: 3 });
  defs.push({ key: "trail", label: "Trailblazer", unit: ["charter finished", "charters finished"], verb: "charters explored", need: 3 });
  defs.push({ key: "sharp", label: "Sharp Eye", unit: ["new bug filed", "new bugs filed"], verb: "new bugs filed from runs", need: 3 });
  const [bashBugs, sessions, bugs] = await Promise.all([
    db.bashItem.findMany({ where: { kind: "bug", createdAt: { gte: since }, bash: { projectId: { in: projectIds } }, review: "file", mergedIntoId: null }, select: { byId: true, createdAt: true } }),
    db.testResult.findMany({ where: { run: { projectId: { in: projectIds } }, createdAt: { gte: since }, imported: false, sessionLog: { not: Prisma.AnyNull } }, select: { testerId: true, createdAt: true } }),
    db.defect.findMany({ where: { projectId: { in: projectIds }, createdAt: { gte: since }, filed: true, status: { not: "WONT_FIX" }, links: { some: {} } }, select: { createdById: true, createdAt: true } }),
  ]);
  for (const b of bashBugs) add("bash", b.byId, b.createdAt);
  for (const s of sessions) add("trail", s.testerId, s.createdAt);
  for (const d of bugs) add("sharp", d.createdById, d.createdAt);

  // Keeper of Words (ver_113): Glossary terms added or answered. The Glossary is one list for
  // everyone, so this counts the whole team's terms; it's listed in every umbrella.
  defs.push({ key: "words", label: "Keeper of Words", unit: ["term added or answered", "terms added or answered"], verb: "Glossary terms added or answered", need: WORDS_NEED });
  for (const t of await glossaryWork({ OR: [{ createdAt: { gte: since } }, { answeredAt: { gte: since } }] })) {
    if (!countsForXp(t.meaning)) continue;
    const at = t.answeredById ? (t.answeredAt ?? t.createdAt) : t.createdAt;
    if (at >= since) add("words", t.answeredById ?? t.createdById, at);
  }
  return { defs, counts };
}

/**
 * Count again and hand each crown to whoever does the most now. Ties go to the holder;
 * an empty crown goes to whoever got there first. Someone who loses the crown they wear
 * gets their earlier title back. Runs after results, bugs, bash finds and sessions are
 * saved, and when the Account page opens (so quiet holders lose crowns as days pass).
 */
export async function refreshCrownsBefore(groupId: string) {
  const counted = await countCrowns(groupId);
  if (!counted) return;
  const { defs, counts } = counted;
  const existing = await db.crown.findMany({ where: { groupId } });
  for (const def of defs) {
    const m = counts.get(def.key) ?? new Map<string, Count>();
    const row = existing.find((c) => c.key === def.key);
    const holder = row?.userId ?? null;
    const held = holder ? (m.get(holder)?.n ?? 0) : 0;
    const best = [...m.entries()].filter(([, c]) => c.n >= def.need).sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)[0];
    let next = holder && held >= def.need ? holder : null;
    if (best && (!next || best[1].n > held)) next = best[0];
    const json = Object.fromEntries([...m.entries()].map(([id, c]) => [id, c.n])) as Prisma.InputJsonValue;
    // upsert: two saves at once can both find no row and both try to make it.
    if (!row) await db.crown.upsert({ where: { groupId_key: { groupId, key: def.key } }, create: { groupId, key: def.key, label: def.label, userId: next, counts: json }, update: { label: def.label, counts: json } });
    else await db.crown.update({ where: { id: row.id }, data: { label: def.label, counts: json, ...(next !== holder ? { userId: next, since: new Date() } : {}) } });
    if (holder && next !== holder) await takeOff(holder, groupId, def.key);
  }
  // Crowns whose platform or folder went away.
  const gone = existing.filter((c) => !defs.some((d) => d.key === c.key));
  for (const c of gone) if (c.userId) await takeOff(c.userId, groupId, c.key);
  if (gone.length) await db.crown.deleteMany({ where: { id: { in: gone.map((c) => c.id) } } });
}

/** The title id a crown is worn under: "crown|<groupId>|<key>|<label>|<umbrella>". */
export const crownTitleId = (groupId: string, key: string, label: string, umbrella: string) => ["crown", groupId, key, label.replace(/\|/g, "/"), umbrella.replace(/\|/g, "/")].join("|");

async function takeOff(userId: string, groupId: string, key: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { gameTitle: true, gameTitleBefore: true } });
  if (u?.gameTitle?.startsWith(`crown|${groupId}|${key}|`)) await db.user.update({ where: { id: userId }, data: { gameTitle: u.gameTitleBefore ?? null, gameTitleBefore: null } });
}

export type CrownView = {
  groupId: string;
  umbrella: string;
  key: string;
  label: string;
  titleId: string;
  holderId: string | null;
  holderName: string | null;
  since: Date;
  mine: number;
  /** The holder's count, or the most anyone has when it's empty. */
  top: number;
  /** For a crown you hold, the next best count. */
  nextBest: number;
  need: number;
  unit: [string, string];
  verb: string;
};

/** Every crown in the umbrellas this person is in, counted fresh, for the Account page. */
export async function crownsForBefore(userId: string): Promise<CrownView[]> {
  const groups = await db.projectGroup.findMany({
    where: { hubProjectId: { not: null }, archivedAt: null, projects: { some: { members: { some: { userId } } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const out: CrownView[] = [];
  for (const g of groups) {
    await refreshCrownsBefore(g.id).catch((e) => console.error("Crowns: counting failed", e));
    const counted = await countCrowns(g.id);
    if (!counted) continue;
    const rows = await db.crown.findMany({ where: { groupId: g.id } });
    const holders = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email]));
    for (const def of counted.defs) {
      const row = rows.find((r) => r.key === def.key);
      if (!row) continue;
      const m = counted.counts.get(def.key) ?? new Map<string, Count>();
      const all = [...m.entries()].map(([id, c]) => ({ id, n: c.n }));
      const holderN = row.userId ? (m.get(row.userId)?.n ?? 0) : Math.max(0, ...all.map((x) => x.n));
      out.push({
        groupId: g.id,
        umbrella: g.name,
        key: def.key,
        label: def.label,
        titleId: crownTitleId(g.id, def.key, def.label, g.name),
        holderId: row.userId,
        holderName: row.userId ? (holders.get(row.userId) ?? null) : null,
        since: row.since,
        mine: m.get(userId)?.n ?? 0,
        top: holderN,
        nextBest: Math.max(0, ...all.filter((x) => x.id !== userId).map((x) => x.n)),
        need: def.need,
        unit: def.unit,
        verb: def.verb,
      });
    }
  }
  return out;
}
