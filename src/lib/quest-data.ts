import "server-only";
import { db } from "./db";
import { caseKey } from "./format";
import { foeLine, foundRewards, generateQuest, RARITY_LABEL, sentence, type Completion, type QuestMap } from "./quest";
import { autoSlotFor, parseGear, partyOf, photoUrl, questRecord, rescueFinds, rescueLine, SLOT_LABEL, teamwork, troubleLine, type Look, type QuestRecord, type Slot } from "./quest-gear";

const DONE = { notIn: ["UNTESTED", "IN_PROGRESS"] as ("UNTESTED" | "IN_PROGRESS")[] };

/** A run's cases in the order they first got a result, with who saved it and the gear they wore. */
async function completions(runIds: string[]) {
  const byRun = new Map<string, (Completion & { caseNumber: number; caseKey: string })[]>();
  if (!runIds.length) return byRun;
  // Each case's first result in one query with its case key (ver_120). Loading every result with
  // its case through Prisma took about 2 seconds for someone who had tested in a hundred runs.
  const rows = await db.$queryRaw<{ runId: string; entryId: string; createdAt: Date; testerId: string | null; testerName: string; status: Completion["status"]; questGear: unknown; number: number; key: string }[]>`
    select r."runId", r."entryId", r."createdAt", r."testerId", r."testerName", r.status::text as status, r."questGear", c.number, p.key
    from (
      select distinct on ("entryId") "runId", "entryId", "createdAt", "testerId", "testerName", status, "questGear"
      from "TestResult"
      where "runId" = any(${runIds}) and status::text not in ('UNTESTED', 'IN_PROGRESS')
      order by "entryId", "createdAt" asc, id asc
    ) r
    join "RunEntry" e on e.id = r."entryId"
    join "TestCase" c on c.id = e."caseId"
    join "Project" p on p.id = c."projectId"`;
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const r of rows) {
    const list = byRun.get(r.runId) ?? [];
    list.push({
      entryId: r.entryId,
      at: r.createdAt,
      userId: r.testerId,
      name: r.testerName || "Someone",
      status: r.status,
      gear: r.questGear ? parseGear(r.questGear) : null,
      caseNumber: r.number,
      // The case's own key (the Case library's AS-4 in an umbrella, not the test cycle's), ver_89.
      caseKey: caseKey(r.key, r.number),
    });
    byRun.set(r.runId, list);
  }
  return byRun;
}

/** Everything a quest page needs from one run's map and its completions. */
function quest<R extends { id: string; questCatalog: number; _count: { entries: number } }>(run: R, order: (Completion & { caseNumber: number; caseKey: string })[]) {
  const steps = run._count.entries;
  const map: QuestMap = generateQuest(run.id, steps, run.questCatalog);
  const position = Math.min(order.length, steps);
  const rewards = foundRewards(map, order);
  const events = teamwork(map, order, steps);
  // Rescue thank-yous count as finds for the satchel, but don't sit on the map.
  return { run, steps, position, map, order, rewards, teamwork: events, finds: [...rewards, ...rescueFinds(events, order)] };
}

export type QuestSummary = Awaited<ReturnType<typeof questsFor>>[number];

const RUN_SELECT = { id: true, number: true, name: true, state: true, release: true, automated: true, questCatalog: true, createdAt: true, _count: { select: { entries: true } } } as const;

/** Quests for a project's runs, newest first, with progress and the rewards found so far (unfound ones never leave the server). Automated runs never go on a quest (ver_94). */
export async function questsFor(projectId: string, take = 60) {
  const runs = await db.testRun.findMany({ where: { projectId, automated: false }, orderBy: { number: "desc" }, take, select: RUN_SELECT });
  const done = await completions(runs.map((r) => r.id));
  return runs.map((r) => quest(r, done.get(r.id) ?? []));
}

/** One run's quest. */
export async function questForRun(projectId: string, number: number) {
  const run = await db.testRun.findUnique({ where: { projectId_number: { projectId, number } }, select: RUN_SELECT });
  if (!run) return null;
  return quest(run, (await completions([run.id])).get(run.id) ?? []);
}

/** How each party member looks right now (pawn, color and current gear), by user id. */
export async function looksFor(userIds: string[]): Promise<Map<string, Look>> {
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true, questPawn: true, questColor: true, questGear: true, avatarAt: true } })
    : [];
  return new Map(users.map((u) => [u.id, { userId: u.id, name: u.name ?? u.email, pawn: u.questPawn, color: u.questColor, gear: parseGear(u.questGear), photo: photoUrl(u.id, u.avatarAt) }]));
}

/** The party for a run's map: who has saved a case, leader first, with their looks. */
export async function partyLooks(order: Completion[]) {
  const party = partyOf(order);
  const looks = await looksFor(party.map((p) => p.userId).filter((id): id is string => !!id));
  return party.map((p) => ({
    ...(p.userId && looks.get(p.userId)) || { userId: p.userId, name: p.name, pawn: "classic", color: "accent", gear: {} },
    name: p.name,
    cases: order.filter((c) => (p.userId ? c.userId === p.userId : c.name === p.name)).length,
  }));
}

/** One person's quest record across every run they've tested in (since their satchel was last emptied). */
export async function questRecordFor(userId: string) {
  const [user, mine] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { xpSince: true } }),
    db.testResult.findMany({ where: { testerId: userId, status: DONE }, distinct: ["runId"], select: { runId: true } }),
  ]);
  if (!mine.length) return questRecord(userId, []);
  const runs = await db.testRun.findMany({ where: { id: { in: mine.map((m) => m.runId) }, automated: false }, select: RUN_SELECT });
  const done = await completions(runs.map((r) => r.id));
  return questRecord(
    userId,
    runs.map((r) => {
      const q = quest(r, done.get(r.id) ?? []);
      return { map: q.map, done: q.order, steps: q.steps };
    }),
    user.xpSince ?? undefined,
  );
}

/**
 * Quest records for several people at once (ver_129, the Workspace Game admin card): every run
 * anyone tested is loaded and its map built once for everyone, instead of once per person.
 * Each record matches questRecordFor for that person.
 */
export async function questRecordsFor(userIds: string[]) {
  const out = new Map<string, QuestRecord>();
  if (!userIds.length) return out;
  const [users, mine] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, xpSince: true } }),
    db.testResult.findMany({ where: { testerId: { in: userIds }, status: DONE }, distinct: ["testerId", "runId"], select: { testerId: true, runId: true } }),
  ]);
  const runIds = [...new Set(mine.map((m) => m.runId))];
  const runs = runIds.length ? await db.testRun.findMany({ where: { id: { in: runIds }, automated: false }, select: RUN_SELECT }) : [];
  const done = await completions(runs.map((r) => r.id));
  const built = new Map(
    runs.map((r) => {
      const q = quest(r, done.get(r.id) ?? []);
      return [r.id, { map: q.map, done: q.order, steps: q.steps }];
    }),
  );
  const runsOf = new Map<string, (typeof built extends Map<string, infer V> ? V : never)[]>();
  for (const m of mine) {
    const b = m.testerId ? built.get(m.runId) : undefined;
    if (!b) continue;
    const list = runsOf.get(m.testerId!) ?? [];
    list.push(b);
    runsOf.set(m.testerId!, list);
  }
  for (const u of users) out.set(u.id, questRecord(u.id, runsOf.get(u.id) ?? [], u.xpSince ?? undefined));
  return out;
}

export type QuestMoment = { emoji: string; text: string; sub: string; href?: string; link?: string };

/**
 * What a just-saved result did on its run's quest map, for the pop-up after saving:
 * a find, an encounter, trouble, or a rescue. Empty when it didn't move the pawn onto anything.
 */
export async function questMoments(runId: string, entryId: string, savedAt: Date): Promise<QuestMoment[]> {
  const run = await db.testRun.findUnique({ where: { id: runId }, select: { ...RUN_SELECT, project: { select: { key: true } } } });
  if (!run || run.automated) return [];
  const q = quest(run, (await completions([run.id])).get(run.id) ?? []);
  const idx = q.order.findIndex((c) => c.entryId === entryId);
  // Only the save that first finished the case moves the pawn.
  if (idx < 0 || q.order[idx].at.getTime() !== savedAt.getTime()) return [];
  const me = q.order[idx];
  const step = idx + 1;
  const out: QuestMoment[] = [];
  const rescues = q.teamwork.filter((e) => e.helper === me);
  const ev = q.rewards.find((r) => r.step === step);
  // What this save handed the saver: the item on the step, and thank-yous for rescues.
  const found = [...(ev?.kind === "item" ? [ev.id] : []), ...rescues.filter((e) => !e.self).map((e) => e.trouble.thanks.id)];
  const equipped = me.userId && found.length ? await autoEquip(me.userId, found) : new Map<string, Slot>();
  const on = (id: string) => (equipped.has(id) ? ` · Equipped on your pawn (${SLOT_LABEL[equipped.get(id)!]}).` : "");
  // A find that went on the pawn links to Change gear on the Quest map page.
  const gearLink = { href: `/p/${run.project.key}/quests?gear=1#your-pawn`, link: "Change gear" };
  for (const e of rescues)
    out.push({
      emoji: e.self ? "🩹" : "🤝",
      text: rescueLine(e, me.name, e.victim.name, q.map.to),
      sub: e.self ? `Step ${step} · Self-rescue` : `Step ${step} · Teamwork · Thank-you: the ${e.trouble.thanks.name}${on(e.trouble.thanks.id)}`,
      ...(!e.self && equipped.has(e.trouble.thanks.id) ? gearLink : {}),
    });
  if (ev)
    out.push({
      emoji: ev.emoji,
      text: ev.kind === "item" ? `${me.name} found the ${ev.name}!` : sentence(foeLine(me.name, ev.name, me.status, me.gear)),
      sub: `Step ${step} · ${RARITY_LABEL[ev.rarity]}${ev.kind === "item" ? on(ev.id) : ""}`,
      ...(ev.kind === "item" && equipped.has(ev.id) ? gearLink : {}),
    });
  const tr = q.teamwork.find((t) => t.step === step);
  if (tr) out.push({ emoji: tr.trouble.trouble.emoji, text: troubleLine(tr), sub: `Step ${step} · ${RARITY_LABEL[tr.trouble.trouble.rarity]} · the next teammate to save a case comes to help` });
  return out;
}

/** Parties for several quests' maps at once (one lookup of everyone's looks). */
export async function partiesFor(quests: { run: { id: string }; order: Completion[] }[]) {
  const parties = quests.map((q) => ({ id: q.run.id, party: partyOf(q.order), order: q.order }));
  const looks = await looksFor([...new Set(parties.flatMap((p) => p.party.map((c) => c.userId)).filter((id): id is string => !!id))]);
  return new Map(
    parties.map((p) => [
      p.id,
      p.party.map((c) => ({
        ...(c.userId && looks.get(c.userId)) || { userId: c.userId, pawn: "classic", color: "accent", gear: {} },
        name: c.name,
        cases: p.order.filter((o) => (c.userId ? o.userId === c.userId : o.name === c.name)).length,
      })),
    ]),
  );
}

/**
 * Put first finds on the pawn. An item goes on only when it's the first of its
 * kind in the satchel, into the first empty slot it fits (Head, Hand, Off hand,
 * Charm, Companion) that the player hasn't emptied by hand. It never replaces
 * anything. Returns where each item went.
 */
export async function autoEquip(userId: string, itemIds: string[]) {
  const placed = new Map<string, Slot>();
  const user = await db.user.findUnique({ where: { id: userId }, select: { questGear: true, questGearTouched: true, questGearAuto: true } });
  if (!user) return placed;
  const rec = await questRecordFor(userId);
  const gear = parseGear(user.questGear);
  for (const id of new Set(itemIds)) {
    // First of its kind only: this save brought every copy in the satchel.
    if (rec.items.get(id) !== itemIds.filter((x) => x === id).length) continue;
    const slot = autoSlotFor(id, gear, user.questGearTouched);
    if (!slot) continue;
    gear[slot] = id;
    placed.set(id, slot);
  }
  if (placed.size)
    await db.user.update({ where: { id: userId }, data: { questGear: gear, questGearAuto: [...new Set([...user.questGearAuto, ...placed.values()])] } });
  return placed;
}

/** The closest unfound item ahead on any active quest in the viewer's projects, for an empty Gear tab. Never says which item. */
export async function nearestItem(userId: string, isAdmin: boolean) {
  const runs = await db.testRun.findMany({
    where: { state: "ACTIVE", automated: false, project: isAdmin ? {} : { members: { some: { userId } } } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { ...RUN_SELECT, project: { select: { key: true } } },
  });
  const done = await completions(runs.map((r) => r.id));
  let best: { projectKey: string; runNumber: number; runName: string; away: number } | null = null;
  for (const r of runs) {
    const q = quest(r, done.get(r.id) ?? []);
    const next = q.map.events.find((e) => e.kind === "item" && e.step > q.position);
    if (next && (!best || next.step - q.position < best.away)) best = { projectKey: r.project.key, runNumber: r.number, runName: r.name, away: next.step - q.position };
  }
  return { hasRuns: runs.length > 0, best };
}
