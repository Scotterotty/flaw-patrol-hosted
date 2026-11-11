import "server-only";
import { db } from "./db";
import { dungeonLabel, MAX_BUGS, MAX_DUNGEONS, MAX_ROOMS, type DelveBug, type Dungeon } from "./delve";
import { NOT_PRACTICE } from "@/lib/practice";

/**
 * One dungeon per closed run this person tested by hand: results they saved themselves (not
 * imported, uploaded by automation or synced from Qase), in a test cycle that isn't archived and
 * that they can still open. Pass and fail count the same. Their bugs are the ones they wrote or
 * linked on their own results in that run, fixed or not (the run is history).
 */
export async function dungeonsFor(user: { id: string; isAdmin: boolean }): Promise<Dungeon[]> {
  const runWhere = {
    state: "COMPLETED" as const,
    automated: false,
    project: { archivedAt: null, ...NOT_PRACTICE, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) },
  };
  const results = await db.testResult.findMany({
    where: { testerId: user.id, imported: false, automated: false, fromQase: false, status: { not: "UNTESTED" }, run: runWhere },
    select: { runId: true, entryId: true, entry: { select: { title: true, position: true } } },
    orderBy: { createdAt: "desc" },
    take: 20000,
  });
  const byRun = new Map<string, Map<string, { title: string; position: number }>>();
  for (const r of results) {
    const cases = byRun.get(r.runId) ?? new Map();
    cases.set(r.entryId, r.entry);
    byRun.set(r.runId, cases);
  }
  if (!byRun.size) return [];
  const runs = await db.testRun.findMany({
    where: { id: { in: [...byRun.keys()] } },
    select: { id: true, name: true, build: true, createdAt: true, completedAt: true, project: { select: { name: true, platform: true } } },
    orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: MAX_DUNGEONS,
  });
  const links = await db.defectLink.findMany({
    where: { result: { runId: { in: runs.map((r) => r.id) } }, OR: [{ result: { testerId: user.id } }, { defect: { createdById: user.id } }] },
    select: { result: { select: { runId: true } }, defect: { select: { id: true, number: true, title: true, severity: true, externalKey: true } } },
  });
  const bugs = new Map<string, Map<string, DelveBug>>();
  for (const l of links) {
    const d = l.defect;
    const m = bugs.get(l.result.runId) ?? new Map();
    m.set(d.id, { id: d.id, key: d.externalKey ?? `D-${d.number}`, title: d.title, sev: d.severity, n: d.number });
    bugs.set(l.result.runId, m);
  }
  return runs.map((r) => {
    const cases = [...byRun.get(r.id)!.values()].sort((a, b) => a.position - b.position);
    return {
      id: r.id,
      seed: `${r.id}:${user.id}`,
      label: dungeonLabel(r, r.project.platform || r.project.name),
      cases: cases.length,
      rooms: cases.slice(0, MAX_ROOMS).map((c) => c.title),
      bugs: [...(bugs.get(r.id)?.values() ?? [])].slice(0, MAX_BUGS),
    };
  });
}
