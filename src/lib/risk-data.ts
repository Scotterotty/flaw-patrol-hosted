import "server-only";
import { db } from "./db";
import { guessRisk, riskLevel, riskScore, type Level, type RiskLevel } from "./risk";
import { storyCoverage, type CoverageColumn } from "./story-coverage";

// The Risk board's data (ver_93): the release's requirements from Jira, the cases that test
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
};

export async function riskBoard(opts: { homeId: string; release: string; columns: CoverageColumn[] }) {
  const cov = await storyCoverage({ projectId: opts.homeId, libraryIds: [opts.homeId], columns: opts.columns, release: opts.release });
  const allCases = [...new Set(cov.rows.flatMap((r) => r.cases.map((c) => c.id)))];
  const [links, moves] = await Promise.all([
    allCases.length ? db.defectLink.findMany({ where: { result: { caseId: { in: allCases } } }, select: { defectId: true, result: { select: { caseId: true } } } }) : [],
    db.riskRating.findMany({ where: { projectId: opts.homeId, release: opts.release } }),
  ]);
  const bugsOf = new Map<string, Set<string>>();
  for (const l of links) bugsOf.set(l.result.caseId, (bugsOf.get(l.result.caseId) ?? new Set()).add(l.defectId));
  const moveOf = new Map(moves.map((m) => [m.issueKey, m]));
  const cards: RiskCard[] = cov.rows
    // Epics that roll up are judged through their children; the Epic itself still shows.
    .flatMap((r) => [r, ...(r.children ?? [])])
    .filter((r, i, all) => all.findIndex((x) => x.story.key === r.story.key) === i)
    .map((r) => {
      const caseIds = r.cases.map((c) => c.id);
      const pastBugs = new Set(caseIds.flatMap((id) => [...(bugsOf.get(id) ?? [])])).size;
      const g = guessRisk({ priority: r.story.priority ?? "", points: r.story.points ?? null, cases: caseIds.length, pastBugs, failing: r.state === "failing" });
      const m = moveOf.get(r.story.key);
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
      };
    })
    .sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact) || a.key.localeCompare(b.key));
  return { cards, jiraError: cov.jiraError, connected: cov.connected };
}
