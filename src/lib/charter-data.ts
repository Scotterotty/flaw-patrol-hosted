import "server-only";
import { Prisma } from "@prisma/client";
import { parseCharter, parseSessionLog, noteCounts } from "./charter";
import { teamTemplate } from "./charter-templates";
import { db } from "./db";
import { forgivingFilter } from "./fuzzy";
import { umbrellaOf } from "./umbrella";

/** Where a project's charters and team templates live: the umbrella's hub, or the project itself. */
export async function charterHome(project: { id: string; key: string; groupId: string | null }) {
  const u = await umbrellaOf(project);
  return u ? { id: u.hub.id, key: u.hub.key } : { id: project.id, key: project.key };
}

export async function teamTemplates(homeId: string) {
  const rows = await db.charterTemplate.findMany({ where: { projectId: homeId }, orderBy: { name: "asc" } });
  return rows.map(teamTemplate);
}

/** The Charters page list (ver_93): every charter, with its persona, time box and last session. */
export async function charterRows(projectId: string, opts: { archived?: boolean; q?: string } = {}) {
  const q = opts.q?.trim();
  const cases = await db.testCase.findMany({
    where: { projectId, type: "EXPLORATORY", archived: !!opts.archived },
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      title: true,
      persona: { select: { name: true, emoji: true } },
      versions: { orderBy: { version: "desc" }, take: 1, select: { charter: true } },
      project: { select: { key: true } },
    },
  });
  const last = await db.testResult.findMany({
    where: { caseId: { in: cases.map((c) => c.id) }, sessionLog: { not: Prisma.DbNull } },
    orderBy: { createdAt: "desc" },
    distinct: ["caseId"],
    select: { caseId: true, createdAt: true, sessionLog: true, testerName: true },
  });
  const lastOf = new Map(last.map((r) => [r.caseId, r]));
  const rows = cases.map((c) => {
    const charter = parseCharter(c.versions[0]?.charter);
    const r = lastOf.get(c.id);
    const counts = r ? noteCounts(parseSessionLog(r.sessionLog)) : null;
    return {
      id: c.id,
      number: c.number,
      key: c.project.key,
      title: c.title,
      persona: c.persona,
      minutes: charter.minutes,
      prompts: charter.prompts.length,
      last: r ? { at: r.createdAt, by: r.testerName, bugs: counts!.bug, questions: counts!.question } : null,
      close: false,
    };
  });
  // Forgiving search (ver_96): exact matches, then close ones marked `close`.
  const found = forgivingFilter(rows, q ?? "", (c) => `${c.title} ${c.persona?.name ?? ""}`);
  return [...found.exact, ...found.close.map((c) => ({ ...c, close: true }))];
}
