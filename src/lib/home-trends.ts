import "server-only";
import { db } from "./db";
import { caseKey } from "./format";
import { homeTrends, type HomeTrendsData, type ManualRunRow, type TrendRow } from "./home-trends-calc";
import { isSevere } from "./severity";
import { severityScaleFor } from "./severity-server";
import { OPEN_BUG } from "./umbrella";

/** Newest results the box looks at; plenty for years of runs. */
const MAX_RESULTS = 50000;
/** Newest runs tested by hand that By run looks at. */
const MAX_HAND_RUNS = 200;

/**
 * How testing is going: results from every test cycle under an umbrella, newest
 * first, without bug bashes, turned into release and week trends and the two case lists.
 */
export async function loadHomeTrends(hubId: string, projectIds: string[]): Promise<HomeTrendsData> {
  const [results, scale, handRuns] = await Promise.all([
    db.testResult.findMany({
      where: { run: { projectId: { in: projectIds }, bugBash: { is: null } } },
      orderBy: { createdAt: "desc" },
      take: MAX_RESULTS,
      select: {
        caseId: true,
        entryId: true,
        runId: true,
        status: true,
        createdAt: true,
        testerName: true,
        run: { select: { release: true, createdAt: true, automated: true, number: true, name: true, build: true, project: { select: { platform: true, key: true } } } },
        entry: { select: { title: true, testCase: { select: { number: true, archived: true, project: { select: { key: true } } } } } },
        defects: { select: { defect: { select: { id: true, createdAt: true, severity: true, status: true, externalCategory: true } } } },
      },
    }),
    severityScaleFor(hubId),
    // Runs tested by hand for By run, started or not; bug bashes left out.
    db.testRun.findMany({
      where: { projectId: { in: projectIds }, automated: false, bugBash: { is: null } },
      orderBy: { createdAt: "desc" },
      take: MAX_HAND_RUNS,
      select: { id: true, number: true, name: true, release: true, createdAt: true, state: true, project: { select: { platform: true, key: true } } },
    }),
  ]);
  const handCounts = handRuns.length ? await db.runEntry.groupBy({ by: ["runId", "status"], where: { runId: { in: handRuns.map((r) => r.id) } }, _count: true }) : [];
  const manualRows: ManualRunRow[] = handRuns.map((r) => ({
    runId: r.id,
    href: `/p/${r.project.key}/runs/${r.number}`,
    number: r.number,
    name: r.name,
    release: r.release,
    at: r.createdAt,
    platform: r.project.platform,
    open: r.state === "ACTIVE",
    counts: Object.fromEntries(handCounts.filter((c) => c.runId === r.id).map((c) => [c.status, c._count])),
  }));
  const runIds = [...new Set(results.map((r) => r.runId))];
  const counts = runIds.length ? await db.runEntry.groupBy({ by: ["runId"], where: { runId: { in: runIds } }, _count: true }) : [];
  const open = (d: { status: string; externalCategory: string | null }) => d.status === OPEN_BUG.status && d.externalCategory !== "done";
  const rows: TrendRow[] = results.map((r) => ({
    caseId: r.caseId,
    entryId: r.entryId,
    runId: r.runId,
    status: r.status,
    at: r.createdAt,
    release: r.run.release,
    runAt: r.run.createdAt,
    automated: r.run.automated,
    platform: r.run.project.platform,
    testerName: r.testerName,
    title: r.entry.title,
    caseKey: caseKey(r.entry.testCase.project.key, r.entry.testCase.number),
    caseProjectKey: r.entry.testCase.project.key,
    caseNumber: r.entry.testCase.number,
    archived: r.entry.testCase.archived,
    runKey: r.run.project.key,
    runNumber: r.run.number,
    runName: r.run.name,
    build: r.run.build,
    bugs: r.defects.map(({ defect: d }) => ({ id: d.id, at: d.createdAt, severe: isSevere(d.severity, scale), open: open(d) })),
  }));
  return homeTrends(rows, new Map(counts.map((c) => [c.runId, c._count])), new Date(), manualRows);
}
