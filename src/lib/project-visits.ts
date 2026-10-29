import "server-only";
import { db } from "./db";

/** Remember when someone opened a project, for Recent on the Projects page. At most one write a minute. */
export async function recordVisit(userId: string, projectId: string) {
  const now = new Date();
  try {
    const { count } = await db.projectPin.updateMany({
      where: { userId, projectId, OR: [{ visitedAt: null }, { visitedAt: { lt: new Date(now.getTime() - 60_000) } }] },
      data: { visitedAt: now },
    });
    if (count === 0) await db.projectPin.create({ data: { userId, projectId, visitedAt: now } }).catch(() => {});
  } catch {
    // Recent is a convenience; never break the page over it.
  }
}

/** Last time anything happened in each project: a case saved, a run started or a result recorded. */
export async function lastActivity(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, Date>();
  const rows = await db.$queryRaw<{ id: string; at: Date | null }[]>`
    select p.id, greatest(
      (select max("updatedAt") from "TestCase" where "projectId" = p.id),
      (select max("createdAt") from "TestRun" where "projectId" = p.id),
      (select max(t."createdAt") from "TestResult" t join "TestRun" r on r.id = t."runId" where r."projectId" = p.id)
    ) as at
    from "Project" p where p.id = any(${projectIds})`;
  return new Map(rows.filter((r) => r.at).map((r) => [r.id, r.at!]));
}
