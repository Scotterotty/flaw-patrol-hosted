import type { ResultStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { verdictFlips } from "@/lib/run-history";

/**
 * Flaky cases among a project's active cases, or among the given cases: case id
 * to how often its verdict flipped in its last 10 runs (only cases with 2+).
 */
export async function flakyCases(scope: { projectId: string } | { caseIds: string[] }): Promise<Map<string, number>> {
  if ("caseIds" in scope && !scope.caseIds.length) return new Map();
  const rows =
    "caseIds" in scope
      ? await db.$queryRaw<{ caseId: string; statuses: ResultStatus[] }[]>`
          SELECT "caseId", array_agg(status::text ORDER BY "createdAt" DESC) AS statuses
          FROM (SELECT "caseId", status, "createdAt", row_number() OVER (PARTITION BY "caseId" ORDER BY "createdAt" DESC) AS n
                FROM "TestResult" WHERE "caseId" = ANY(${scope.caseIds})) r
          WHERE n <= 10 GROUP BY "caseId"`
      : await db.$queryRaw<{ caseId: string; statuses: ResultStatus[] }[]>`
          SELECT "caseId", array_agg(status::text ORDER BY "createdAt" DESC) AS statuses
          FROM (SELECT "caseId", status, "createdAt", row_number() OVER (PARTITION BY "caseId" ORDER BY "createdAt" DESC) AS n
                FROM "TestResult" WHERE "caseId" IN (SELECT id FROM "TestCase" WHERE "projectId" = ${scope.projectId} AND archived = false)) r
          WHERE n <= 10 GROUP BY "caseId"`;
  const out = new Map<string, number>();
  for (const r of rows) {
    const flips = verdictFlips(r.statuses);
    if (flips >= 2) out.set(r.caseId, flips);
  }
  return out;
}
