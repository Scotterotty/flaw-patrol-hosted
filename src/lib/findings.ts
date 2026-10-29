import "server-only";
import { Prisma } from "@prisma/client";
import { NOTE_KINDS, parsePersona, parseSessionLog, type NoteKind, type PersonaInfo, type SessionNote } from "./charter";
import { db } from "./db";
import { runWhere, type ReportFilters } from "./reports";

// Reports → Session findings: every note, bug, question and idea logged in
// exploratory sessions, grouped by charter.

export type FindingFilters = { kinds: NoteKind[]; personaId?: string; caseId?: string; openOnly: boolean };

export function parseFindingFilters(sp: Record<string, string | undefined>): FindingFilters {
  const kinds = (sp.kinds ?? "").split(",").filter((k): k is NoteKind => (NOTE_KINDS as readonly string[]).includes(k));
  return { kinds, personaId: sp.persona || undefined, caseId: sp.charter || undefined, openOnly: sp.open === "1" };
}

export type Finding = {
  resultId: string;
  note: SessionNote;
  tester: string;
  run: number;
  release: string;
  at: Date;
  answer: { text: string; by: string; at: Date } | null;
};
export type FindingGroup = { caseId: string; number: number; title: string; persona: PersonaInfo | null; personaId: string | null; sessions: number; items: Finding[] };
export type FindingTotals = { sessions: number; seconds: number; bugs: number; questions: number; openQuestions: number; ideas: number; notes: number };

export async function sessionFindings(projectId: string, f: ReportFilters, ff: FindingFilters) {
  const results = await db.testResult.findMany({
    where: {
      run: runWhere(projectId, f),
      entry: { kind: "EXPLORATORY", ...(ff.personaId ? { testCase: { personaId: ff.personaId } } : {}) },
      ...(ff.caseId ? { caseId: ff.caseId } : {}),
      sessionLog: { not: Prisma.DbNull },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      id: true,
      caseId: true,
      sessionLog: true,
      elapsedSec: true,
      testerName: true,
      createdAt: true,
      run: { select: { number: true, release: true } },
      entry: { select: { title: true, persona: true, testCase: { select: { number: true, title: true, personaId: true } } } },
      answers: { select: { noteId: true, text: true, answeredBy: true, createdAt: true } },
    },
  });

  const totals: FindingTotals = { sessions: 0, seconds: 0, bugs: 0, questions: 0, openQuestions: 0, ideas: 0, notes: 0 };
  const groups = new Map<string, FindingGroup>();
  for (const r of results) {
    const log = parseSessionLog(r.sessionLog);
    totals.sessions++;
    totals.seconds += r.elapsedSec ?? 0;
    const answers = new Map(r.answers.map((a) => [a.noteId, { text: a.text, by: a.answeredBy, at: a.createdAt }]));
    const g = groups.get(r.caseId) ?? {
      caseId: r.caseId,
      number: r.entry.testCase.number,
      title: r.entry.testCase.title,
      persona: parsePersona(r.entry.persona),
      personaId: r.entry.testCase.personaId,
      sessions: 0,
      items: [],
    };
    g.sessions++;
    for (const note of log) {
      // Ticked prompts (ver_93) are coverage, not findings.
      if (note.kind === "covered") continue;
      const answer = answers.get(note.id) ?? null;
      if (note.kind === "bug") totals.bugs++;
      else if (note.kind === "idea") totals.ideas++;
      else if (note.kind === "note") totals.notes++;
      else {
        totals.questions++;
        if (!answer) totals.openQuestions++;
      }
      if (ff.kinds.length && !ff.kinds.includes(note.kind)) continue;
      if (ff.openOnly && (note.kind !== "question" || answer)) continue;
      g.items.push({ resultId: r.id, note, tester: r.testerName, run: r.run.number, release: r.run.release, at: r.createdAt, answer });
    }
    groups.set(r.caseId, g);
  }
  return { totals, groups: [...groups.values()].filter((g) => g.items.length > 0) };
}

/** Charters and personas that have sessions, for the filter menus. */
export async function findingOptions(projectId: string) {
  const [charters, personas] = await Promise.all([
    db.testCase.findMany({ where: { projectId, type: "EXPLORATORY" }, select: { id: true, number: true, title: true }, orderBy: { number: "asc" } }),
    db.persona.findMany({ where: { projectId }, select: { id: true, name: true, emoji: true }, orderBy: { name: "asc" } }),
  ]);
  return { charters, personas };
}

