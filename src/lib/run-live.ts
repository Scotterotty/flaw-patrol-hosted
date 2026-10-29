import "server-only";
import { noteCounts, parseCharter, parsePersona, parseSessionLog, type PersonaInfo } from "./charter";
import { db } from "./db";
import { parseDraft } from "./run-draft";
import { EXPLORE_KIND, shownKind } from "./run-kinds";

// What Runs in progress says about exploring and bug bash runs (ver_96): time and finds
// instead of "0 of 1 tested", and a button that says what you'll do.

export type ExploreLive = { type: "explore"; started: boolean; usedMin: number; limitMin: number; who: string; persona: PersonaInfo | null; bugs: number; notes: number; questions: number };
export type BashLive = { type: "bash"; bashId: string; homeKey: string; live: boolean; minutesLeft: number; people: number; bugs: number; areas: number; startedAt: Date };
export type RunLive = ExploreLive | BashLive;

export async function runLive(runIds: string[], now = new Date()): Promise<Map<string, RunLive>> {
  const out = new Map<string, RunLive>();
  if (!runIds.length) return out;
  const runs = await db.testRun.findMany({
    where: { id: { in: runIds } },
    select: {
      id: true,
      kind: true,
      entries: { select: { id: true, kind: true, charter: true, persona: true, draft: true, draftByName: true, status: true } },
      bugBash: { select: { id: true, startsAt: true, endsAt: true, endedAt: true, areas: true, project: { select: { key: true } }, _count: { select: { people: true, items: { where: { kind: "bug", mergedIntoId: null } } } } } },
    },
  });
  const exploreIds = runs.filter((r) => shownKind(r) === EXPLORE_KIND).flatMap((r) => r.entries.map((e) => e.id));
  const results = exploreIds.length
    ? await db.testResult.findMany({ where: { entryId: { in: exploreIds } }, orderBy: { createdAt: "desc" }, distinct: ["entryId"], select: { entryId: true, elapsedSec: true, sessionLog: true, testerName: true } })
    : [];
  const resultOf = new Map(results.map((r) => [r.entryId, r]));
  for (const r of runs) {
    if (r.bugBash) {
      const b = r.bugBash;
      const live = !b.endedAt && b.startsAt <= now && b.endsAt > now;
      out.set(r.id, {
        type: "bash",
        bashId: b.id,
        homeKey: b.project.key,
        live,
        minutesLeft: Math.max(0, Math.ceil((b.endsAt.getTime() - now.getTime()) / 60_000)),
        people: b._count.people,
        bugs: b._count.items,
        areas: Array.isArray(b.areas) ? b.areas.length : 0,
        startedAt: b.startsAt,
      });
      continue;
    }
    if (shownKind(r) !== EXPLORE_KIND) continue;
    let used = 0;
    let limit = 0;
    let who = "";
    let persona: PersonaInfo | null = null;
    const counts = { bug: 0, note: 0, question: 0 };
    let started = false;
    for (const e of r.entries) {
      limit += parseCharter(e.charter).minutes;
      persona ??= parsePersona(e.persona);
      const draft = parseDraft(e.draft);
      const saved = resultOf.get(e.id);
      const notes = draft ? draft.notes : saved ? parseSessionLog(saved.sessionLog) : [];
      const sec = draft ? draft.elapsedSec : (saved?.elapsedSec ?? 0);
      if (sec > 0 || notes.length) started = true;
      used += sec;
      who ||= draft ? e.draftByName : (saved?.testerName ?? "");
      const c = noteCounts(notes);
      counts.bug += c.bug;
      counts.note += c.note;
      counts.question += c.question;
    }
    out.set(r.id, { type: "explore", started, usedMin: Math.round(used / 60), limitMin: limit, who, persona, bugs: counts.bug, notes: counts.note, questions: counts.question });
  }
  return out;
}

/** "2 bugs, 3 notes, 1 question", or "No finds yet". */
export function findsLine(x: { bugs: number; notes: number; questions: number }) {
  const parts = [x.bugs && `${x.bugs} ${x.bugs === 1 ? "bug" : "bugs"}`, x.notes && `${x.notes} ${x.notes === 1 ? "note" : "notes"}`, x.questions && `${x.questions} ${x.questions === 1 ? "question" : "questions"}`].filter(Boolean);
  return parts.length ? parts.join(", ") : "No finds yet";
}
