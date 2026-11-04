import "server-only";
import { db } from "./db";
import { guessRisk, riskLevel, riskScore, type Level, type RiskLevel } from "./risk";
import { storyCoverage, type CoverageColumn } from "./story-coverage";

// The Risk board's data: the release's requirements from Jira, the cases that test
// them, their bug history, Flaw Patrol's first guess, and any moves people made.

export type RiskCard = {
  key: string;
  title: string;
  url: string | null;
  type: string;
  status: string;
  priority: string;
  points: number | null;
  caseIds: string[];
  cases: number;
  pastBugs: number;
  state: "none" | "failing" | "notrun" | "passing";
  likelihood: Level;
  impact: Level;
  guess: { likelihood: Level; impact: Level };
  reasons: string[];
  moved: { by: string; at: string } | null;
  level: RiskLevel;
  /** The picked release this card is in: where its moves are saved (ver_161, several releases on one board). */
  release: string;
};

/** One release's board, or several releases on one board (ver_161): each card keeps the release it's in. */
export async function riskBoard(opts: { homeId: string; release: string | string[]; columns: CoverageColumn[]; withCases?: boolean }) {
  const releases = (Array.isArray(opts.release) ? opts.release : [opts.release]).filter(Boolean);
  const cov = await storyCoverage({ projectId: opts.homeId, libraryIds: [opts.homeId], columns: opts.columns, release: releases });
  const allCases = [...new Set(cov.rows.flatMap((r) => r.cases.map((c) => c.id)))];
  const [links, moves] = await Promise.all([
    allCases.length ? db.defectLink.findMany({ where: { result: { caseId: { in: allCases } } }, select: { defectId: true, result: { select: { caseId: true } } } }) : [],
    db.riskRating.findMany({ where: { projectId: opts.homeId, release: { in: releases } } }),
  ]);
  const bugsOf = new Map<string, Set<string>>();
  for (const l of links) bugsOf.set(l.result.caseId, (bugsOf.get(l.result.caseId) ?? new Set()).add(l.defectId));
  const moveOf = new Map(moves.map((m) => [`${m.release}|${m.issueKey}`, m]));
  const releaseOf = (r: { story: { releases?: string[] } }) => releases.find((x) => r.story.releases?.includes(x)) ?? releases[0] ?? "";
  const cards: RiskCard[] = cov.rows
    // Epics that roll up are judged through their children; the Epic itself still shows.
    .flatMap((r) => [r, ...(r.children ?? [])])
    .filter((r, i, all) => all.findIndex((x) => x.story.key === r.story.key) === i)
    .map((r) => {
      const caseIds = r.cases.map((c) => c.id);
      const pastBugs = new Set(caseIds.flatMap((id) => [...(bugsOf.get(id) ?? [])])).size;
      const g = guessRisk({ priority: r.story.priority ?? "", points: r.story.points ?? null, cases: caseIds.length, pastBugs, failing: r.state === "failing", withCases: opts.withCases });
      const release = releaseOf(r);
      const m = moveOf.get(`${release}|${r.story.key}`);
      const likelihood = (m ? Math.min(3, Math.max(1, m.likelihood)) : g.likelihood) as Level;
      const impact = (m ? Math.min(3, Math.max(1, m.impact)) : g.impact) as Level;
      return {
        key: r.story.key,
        title: r.story.title,
        url: r.story.url,
        type: r.story.type ?? "",
        status: r.story.status,
        priority: r.story.priority ?? "",
        points: r.story.points ?? null,
        caseIds,
        cases: caseIds.length,
        pastBugs,
        state: r.state,
        likelihood,
        impact,
        guess: { likelihood: g.likelihood, impact: g.impact },
        reasons: g.reasons,
        moved: m ? { by: m.movedBy, at: m.movedAt.toISOString() } : null,
        level: riskLevel(likelihood, impact),
        release,
      };
    })
    .sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact) || a.key.localeCompare(b.key));
  return { cards, jiraError: cov.jiraError, connected: cov.connected, config: cov.config, bugProject: cov.bugProject };
}
