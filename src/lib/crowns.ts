import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { parsePlatforms } from "./umbrella";
import { countsForXp } from "./glossary";
import { glossaryWork } from "./glossary-data";

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

type Counted = { defs: CrownDef[]; counts: Map<string, Map<string, Count>> };

/**
 * Every crown in each of these umbrellas, with each player's count over the last 30 days.
 * ver_129: all umbrellas are counted together, one set of lookups for the lot, instead of
 * the same lookups again for every umbrella. Umbrellas without a hub or archived are left out.
 */
async function countCrownsMany(groupIds: string[]): Promise<Map<string, Counted>> {
  const out = new Map<string, Counted>();
  if (!groupIds.length) return out;
  const groups = (
    await db.projectGroup.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, platforms: true, hubProjectId: true, archivedAt: true, projects: { select: { id: true, platform: true, archivedAt: true } } },
    })
  ).filter((g): g is typeof g & { hubProjectId: string } => !!g.hubProjectId && !g.archivedAt);
  if (!groups.length) return out;
  const since = new Date(Date.now() - CROWN_DAYS * DAY);
  // A test cycle sits in one umbrella, so each project's work counts toward that umbrella only.
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const p of g.projects) groupOf.set(p.id, g.id);
  const projectIds = [...groupOf.keys()];
  const hubIds = groups.map((g) => g.hubProjectId);

  const [members, folders, cases, bashBugs, sessions, bugs, words] = await Promise.all([
    db.projectMember.findMany({ where: { projectId: { in: projectIds }, user: { gameEnabled: true } }, select: { projectId: true, userId: true } }),
    db.folder.findMany({ where: { projectId: { in: hubIds } }, select: { id: true, parentId: true, name: true, projectId: true } }),
    db.testCase.findMany({ where: { projectId: { in: hubIds }, archived: false }, select: { id: true, folderId: true, projectId: true } }),
    db.bashItem.findMany({ where: { kind: "bug", createdAt: { gte: since }, bash: { projectId: { in: projectIds } }, review: "file", mergedIntoId: null }, select: { byId: true, createdAt: true, bash: { select: { projectId: true } } } }),
    db.testResult.findMany({ where: { run: { projectId: { in: projectIds } }, createdAt: { gte: since }, imported: false, sessionLog: { not: Prisma.AnyNull } }, select: { testerId: true, createdAt: true, run: { select: { projectId: true } } } }),
    db.defect.findMany({ where: { projectId: { in: projectIds }, createdAt: { gte: since }, filed: true, status: { not: "WONT_FIX" }, links: { some: {} } }, select: { createdById: true, createdAt: true, projectId: true } }),
    glossaryWork({ OR: [{ createdAt: { gte: since } }, { answeredAt: { gte: since } }] }),
  ]);
  const players = new Map<string, Set<string>>(groups.map((g) => [g.id, new Set<string>()]));
  for (const m of members) players.get(groupOf.get(m.projectId)!)?.add(m.userId);
  const allPlayers = [...new Set(members.map((m) => m.userId))];

  // Cases given a verdict by hand, once per run and case (the latest result).
  const results = allPlayers.length
    ? await db.testResult.findMany({
        where: {
          run: { projectId: { in: projectIds }, automated: false },
          createdAt: { gte: since },
          status: { in: ["PASSED", "FAILED", "BLOCKED"] },
          imported: false,
          automated: false,
          testerId: { in: allPlayers },
          entry: { kind: { not: "EXPLORATORY" } },
        },
        select: { runId: true, caseId: true, testerId: true, createdAt: true, run: { select: { projectId: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const perRunCase = new Map<string, (typeof results)[number]>();
  // Only the umbrella's own players' results count, so pick the latest among them.
  for (const r of results) if (r.testerId && players.get(groupOf.get(r.run.projectId)!)?.has(r.testerId)) perRunCase.set(`${r.runId}:${r.caseId}`, r);
  const onceByGroup = new Map<string, (typeof results)[number][]>();
  for (const r of perRunCase.values()) {
    const g = groupOf.get(r.run.projectId)!;
    const list = onceByGroup.get(g) ?? [];
    list.push(r);
    onceByGroup.set(g, list);
  }

  const wordsDone: { userId: string; at: Date }[] = [];
  for (const t of words) {
    if (!countsForXp(t.meaning)) continue;
    const at = t.answeredById ? (t.answeredAt ?? t.createdAt) : t.createdAt;
    const userId = t.answeredById ?? t.createdById;
    if (at >= since && userId) wordsDone.push({ userId, at });
  }

  for (const group of groups) {
    const groupPlayers = players.get(group.id)!;
    const defs: CrownDef[] = [];
    const counts = new Map<string, Map<string, Count>>();
    const add = (key: string, userId: string | null, at: Date) => {
      if (!userId || !groupPlayers.has(userId)) return;
      const m = counts.get(key) ?? new Map<string, Count>();
      counts.set(key, m);
      const c = m.get(userId) ?? { n: 0, first: at.getTime() };
      c.n++;
      c.first = Math.min(c.first, at.getTime());
      m.set(userId, c);
    };
    const once = onceByGroup.get(group.id) ?? [];
    const mine = <T,>(rows: T[], projectOf: (r: T) => string) => rows.filter((r) => groupOf.get(projectOf(r)) === group.id);

    // Ruler of {platform}: cases run in that platform's test cycles.
    const platformOf = new Map(group.projects.map((p) => [p.id, p.platform.toLowerCase()]));
    for (const p of parsePlatforms(group.platforms)) {
      const key = `platform:${p.name}`;
      defs.push({ key, label: p.crownName || `Ruler of ${p.name}`, unit: [`${p.name} case`, `${p.name} cases`], verb: `${p.name} cases`, need: 10 });
      for (const r of once) if (platformOf.get(r.run.projectId) === p.name.toLowerCase()) add(key, r.testerId, r.createdAt);
    }

    // Keeper of {folder}: cases run from each top-level folder of the Case library.
    const hubFolders = folders.filter((f) => f.projectId === group.hubProjectId);
    const parent = new Map(hubFolders.map((f) => [f.id, f.parentId]));
    const top = (id: string | null) => {
      let cur = id;
      for (let i = 0; cur && parent.get(cur) && i < 50; i++) cur = parent.get(cur)!;
      return cur;
    };
    const caseTop = new Map(cases.filter((c) => c.projectId === group.hubProjectId).map((c) => [c.id, top(c.folderId)]));
    const sizes = new Map<string, number>();
    for (const t of caseTop.values()) if (t) sizes.set(t, (sizes.get(t) ?? 0) + 1);
    for (const f of hubFolders.filter((f) => !f.parentId && (sizes.get(f.id) ?? 0) >= FOLDER_MIN_CASES).sort((a, b) => a.name.localeCompare(b.name))) {
      const key = `folder:${f.id}`;
      defs.push({ key, label: `Keeper of ${f.name}`, unit: [`case from ${f.name}`, `cases from ${f.name}`], verb: `cases from the ${f.name} folder`, need: 10 });
      for (const r of once) if (caseTop.get(r.caseId) === f.id) add(key, r.testerId, r.createdAt);
    }

    // Bug Bash Champion, Trailblazer and Sharp Eye: one each per umbrella.
    defs.push({ key: "bash", label: "Bug Bash Champion", unit: ["bug in bug bashes", "bugs in bug bashes"], verb: "bugs in bug bashes", need: 3 });
    defs.push({ key: "trail", label: "Trailblazer", unit: ["charter finished", "charters finished"], verb: "charters explored", need: 3 });
    defs.push({ key: "sharp", label: "Sharp Eye", unit: ["new bug filed", "new bugs filed"], verb: "new bugs filed from runs", need: 3 });
    for (const b of mine(bashBugs, (b) => b.bash.projectId)) add("bash", b.byId, b.createdAt);
    for (const s of mine(sessions, (s) => s.run.projectId)) add("trail", s.testerId, s.createdAt);
    for (const d of mine(bugs, (d) => d.projectId)) add("sharp", d.createdById, d.createdAt);

    // Keeper of Words (ver_113): Glossary terms added or answered. The Glossary is one list for
    // everyone, so this counts the whole team's terms; it's listed in every umbrella.
    defs.push({ key: "words", label: "Keeper of Words", unit: ["term added or answered", "terms added or answered"], verb: "Glossary terms added or answered", need: WORDS_NEED });
    for (const w of wordsDone) add("words", w.userId, w.at);
    out.set(group.id, { defs, counts });
  }
  return out;
}

type CrownRow = Awaited<ReturnType<typeof db.crown.findMany>>[number];

const sameCounts = (a: unknown, b: Record<string, number>) => {
  const x = (a ?? {}) as Record<string, unknown>;
  const keys = Object.keys(b);
  return Object.keys(x).length === keys.length && keys.every((k) => x[k] === b[k]);
};

/**
 * Count again and hand each crown to whoever does the most now. Ties go to the holder;
 * an empty crown goes to whoever got there first. Someone who loses the crown they wear
 * gets their earlier title back. Runs after results, bugs, bash finds and sessions are
 * saved, and when the Account page opens (so quiet holders lose crowns as days pass).
 * ver_129: only crowns whose holder, name or counts changed are saved, all at once.
 * Hands back the umbrella's crowns as they are now.
 */
async function settleCrowns(groupId: string, counted: Counted, existing: CrownRow[]): Promise<CrownRow[]> {
  const { defs, counts } = counted;
  const saves: Promise<CrownRow>[] = [];
  const takeOffs: [string, string][] = [];
  const kept: CrownRow[] = [];
  for (const def of defs) {
    const m = counts.get(def.key) ?? new Map<string, Count>();
    const row = existing.find((c) => c.key === def.key);
    const holder = row?.userId ?? null;
    const held = holder ? (m.get(holder)?.n ?? 0) : 0;
    const best = [...m.entries()].filter(([, c]) => c.n >= def.need).sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)[0];
    let next = holder && held >= def.need ? holder : null;
    if (best && (!next || best[1].n > held)) next = best[0];
    const plain = Object.fromEntries([...m.entries()].map(([id, c]) => [id, c.n]));
    const json = plain as Prisma.InputJsonValue;
    // upsert: two saves at once can both find no row and both try to make it.
    if (!row) saves.push(db.crown.upsert({ where: { groupId_key: { groupId, key: def.key } }, create: { groupId, key: def.key, label: def.label, userId: next, counts: json }, update: { label: def.label, counts: json } }));
    else if (next !== holder || row.label !== def.label || !sameCounts(row.counts, plain))
      saves.push(db.crown.update({ where: { id: row.id }, data: { label: def.label, counts: json, ...(next !== holder ? { userId: next, since: new Date() } : {}) } }));
    else kept.push(row);
    if (holder && next !== holder) takeOffs.push([holder, def.key]);
  }
  const saved = await Promise.all(saves);
  for (const [holder, key] of takeOffs) await takeOff(holder, groupId, key);
  // Crowns whose platform or folder went away.
  const gone = existing.filter((c) => !defs.some((d) => d.key === c.key));
  for (const c of gone) if (c.userId) await takeOff(c.userId, groupId, c.key);
  if (gone.length) await db.crown.deleteMany({ where: { id: { in: gone.map((c) => c.id) } } });
  return [...kept, ...saved];
}

/** Settle one umbrella's crowns, or several counted together. */
export async function refreshCrowns(groupIds: string | string[]) {
  const ids = typeof groupIds === "string" ? [groupIds] : groupIds;
  if (!ids.length) return;
  const [countedAll, existingAll] = await Promise.all([countCrownsMany(ids), db.crown.findMany({ where: { groupId: { in: ids } } })]);
  for (const [groupId, counted] of countedAll) await settleCrowns(groupId, counted, existingAll.filter((r) => r.groupId === groupId));
}

/** Refresh quietly: a failed count never breaks the save that set it off. */
export async function refreshCrownsFor(projectId: string) {
  try {
    const p = await db.project.findUnique({ where: { id: projectId }, select: { groupId: true, hubOf: { select: { id: true } } } });
    const groupId = p?.hubOf?.id ?? p?.groupId;
    if (groupId) await refreshCrowns(groupId);
  } catch (e) {
    console.error("Crowns: counting failed", e);
  }
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

/**
 * Every crown in the umbrellas this person is in, counted fresh, for the Account page.
 * ver_129: counts every umbrella once, together, and reuses that count for the page.
 */
export async function crownsFor(userId: string): Promise<CrownView[]> {
  const groups = await db.projectGroup.findMany({
    where: { hubProjectId: { not: null }, archivedAt: null, projects: { some: { members: { some: { userId } } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (!groups.length) return [];
  const ids = groups.map((g) => g.id);
  const [countedAll, existingAll] = await Promise.all([countCrownsMany(ids), db.crown.findMany({ where: { groupId: { in: ids } } })]);
  const rowsOf = new Map<string, CrownRow[]>();
  await Promise.all(
    groups.map(async (g) => {
      const counted = countedAll.get(g.id);
      if (!counted) return;
      const existing = existingAll.filter((r) => r.groupId === g.id);
      rowsOf.set(
        g.id,
        await settleCrowns(g.id, counted, existing).catch(async (e) => {
          console.error("Crowns: counting failed", e);
          return db.crown.findMany({ where: { groupId: g.id } });
        }),
      );
    }),
  );
  const holderIds = [...new Set([...rowsOf.values()].flat().map((r) => r.userId).filter((x): x is string => !!x))];
  const holders = new Map((holderIds.length ? await db.user.findMany({ where: { id: { in: holderIds } }, select: { id: true, name: true, email: true } }) : []).map((u) => [u.id, u.name || u.email]));
  const out: CrownView[] = [];
  for (const g of groups) {
    const counted = countedAll.get(g.id);
    const rows = rowsOf.get(g.id);
    if (!counted || !rows) continue;
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

/** How many more you need to take a crown: beat the holder (ties go to them), or reach the minimum. */
export const toTake = (c: Pick<CrownView, "mine" | "top" | "need" | "holderId">) => Math.max(c.need - c.mine, c.holderId ? c.top + 1 - c.mine : 0, 1);

/**
 * What changed since this person was last told (ver_96): crowns they took and crowns
 * someone took from them. `held` is what they hold now, for ackCrowns.
 */
export async function crownChanges(user: { id: string; crownsSeen: string[] }) {
  const rows = await db.crown.findMany({ where: { OR: [{ userId: user.id }, { id: { in: user.crownsSeen } }] } });
  const held = rows.filter((r) => r.userId === user.id);
  const heldIds = held.map((r) => r.id);
  const seen = new Set(user.crownsSeen);
  const took = held.filter((r) => !seen.has(r.id));
  const lost = rows.filter((r) => seen.has(r.id) && r.userId !== user.id);
  if (!took.length && !lost.length) return { held: heldIds, changes: [] };
  const groups = new Map((await db.projectGroup.findMany({ where: { id: { in: rows.map((r) => r.groupId) } }, select: { id: true, name: true } })).map((g) => [g.id, g.name]));
  const people = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email]));
  const countOf = (r: (typeof rows)[number], id: string | null) => (id ? Number((r.counts as Record<string, number>)?.[id] ?? 0) : 0);
  const changes = [
    ...took.map((r) => {
      const umbrella = groups.get(r.groupId) ?? "";
      return { id: r.id, kind: "took" as const, label: r.label, umbrella, titleId: crownTitleId(r.groupId, r.key, r.label, umbrella), line: `You're now ${r.label} in ${umbrella}.`, sub: `With ${countOf(r, user.id)} in the last ${CROWN_DAYS} days.` };
    }),
    ...lost.map((r) => {
      const umbrella = groups.get(r.groupId) ?? "";
      const who = r.userId ? (people.get(r.userId) ?? "Someone") : null;
      const more = r.userId ? countOf(r, r.userId) + 1 - countOf(r, user.id) : 0;
      return {
        id: r.id,
        kind: "lost" as const,
        label: r.label,
        umbrella,
        line: who ? `${who} took ${r.label} in ${umbrella}.` : `${r.label} in ${umbrella} is free again.`,
        sub: who ? `Do ${Math.max(1, more)} more in the last ${CROWN_DAYS} days to take it back.` : `Nobody has done enough in the last ${CROWN_DAYS} days to hold it.`,
      };
    }),
  ];
  return { held: heldIds, changes };
}
