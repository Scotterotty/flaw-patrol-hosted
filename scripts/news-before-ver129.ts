// New/Updated counts for the Test runs list as worked out before ver_129 (src/lib/case-news-data.ts),
// kept only for npm run check:news.
import "server-only";
import { changeSummary, stepChanges, type CaseNews } from "@/lib/case-news";
import { db } from "@/lib/db";
import type { ExpandedStep } from "@/lib/steps";

const asSteps = (v: unknown) => (Array.isArray(v) ? v : []) as ExpandedStep[];

type Entry = { id: string; caseId: string; steps: unknown; preconditions: string; caseVersion: number };

/** New/Updated for each of a run's entries, by entry id. Plain cases show nothing. */
async function caseNewsForRun(run: { id: string; createdAt: Date }, entries: Entry[]) {
  const out = new Map<string, CaseNews>();
  if (!entries.length) return out;
  const caseIds = [...new Set(entries.map((e) => e.caseId))];
  const earlier = await db.runEntry.findMany({
    where: { caseId: { in: caseIds }, runId: { not: run.id }, run: { createdAt: { lt: run.createdAt } } },
    orderBy: { run: { createdAt: "desc" } },
    select: { caseId: true, steps: true, preconditions: true, caseVersion: true, run: { select: { number: true, createdAt: true } }, _count: { select: { results: true } } },
  });
  const tested = new Set(earlier.filter((e) => e._count.results > 0).map((e) => e.caseId));
  for (const c of await db.testCase.findMany({ where: { id: { in: caseIds }, runBefore: true }, select: { id: true } })) tested.add(c.id);
  const versions = await db.caseVersion.findMany({
    where: { caseId: { in: caseIds } },
    orderBy: { version: "asc" },
    select: { caseId: true, version: true, authorName: true, createdAt: true },
  });
  for (const e of entries) {
    const mine = versions.filter((v) => v.caseId === e.caseId);
    if (!tested.has(e.caseId)) {
      const first = mine[0];
      out.set(e.id, { kind: "new", addedBy: first?.authorName || "someone", addedAt: (first?.createdAt ?? run.createdAt).toISOString() });
      continue;
    }
    const last = earlier.find((x) => x.caseId === e.caseId);
    if (!last) continue;
    const now = asSteps(e.steps);
    const { steps, removed } = stepChanges(asSteps(last.steps), now);
    const pre = last.preconditions.trim() !== e.preconditions.trim();
    if (!Object.keys(steps).length && !removed && !pre) continue;
    // Who edited it: the newest version between the two copies.
    const edit = [...mine].reverse().find((v) => v.version > last.caseVersion && v.version <= e.caseVersion);
    out.set(e.id, {
      kind: "updated",
      since: { run: last.run.number, at: last.run.createdAt.toISOString(), version: last.caseVersion },
      by: edit?.authorName || "someone",
      at: (edit?.createdAt ?? run.createdAt).toISOString(),
      what: changeSummary(now, steps, removed, pre),
      steps,
      removed,
      preconditions: pre ? last.preconditions : null,
      version: e.caseVersion,
    });
  }
  return out;
}

/** New and Updated counts for the Test runs list, open runs only. */
export async function caseNewsCountsBefore(runIds: string[]) {
  const out = new Map<string, { new: number; updated: number }>();
  if (!runIds.length) return out;
  const runs = await db.testRun.findMany({
    where: { id: { in: runIds } },
    select: { id: true, createdAt: true, entries: { select: { id: true, caseId: true, steps: true, preconditions: true, caseVersion: true } } },
  });
  await Promise.all(
    runs.map(async (r) => {
      const news = [...(await caseNewsForRun(r, r.entries)).values()];
      const c = { new: news.filter((n) => n.kind === "new").length, updated: news.filter((n) => n.kind === "updated").length };
      if (c.new || c.updated) out.set(r.id, c);
    }),
  );
  return out;
}

