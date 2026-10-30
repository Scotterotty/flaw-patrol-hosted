import "server-only";
import { changeSummary, stepChanges, type CaseNews } from "./case-news";
import { db } from "./db";
import type { ExpandedStep } from "./steps";

// New and Updated cases in a run (ver_96). New: the case never had a result saved in an
// earlier run. Updated: its steps or preconditions differ from the copy its last earlier run used.

const asSteps = (v: unknown) => (Array.isArray(v) ? v : []) as ExpandedStep[];

type Entry = { id: string; caseId: string; steps: unknown; preconditions: string; caseVersion: number };

/** New/Updated for each of a run's entries, by entry id. Plain cases show nothing. */
export async function caseNewsForRun(run: { id: string; createdAt: Date }, entries: Entry[]) {
  const out = new Map<string, CaseNews>();
  if (!entries.length) return out;
  const caseIds = [...new Set(entries.map((e) => e.caseId))];
  const earlier = await db.runEntry.findMany({
    where: { caseId: { in: caseIds }, runId: { not: run.id }, run: { createdAt: { lt: run.createdAt } } },
    orderBy: { run: { createdAt: "desc" } },
    select: { caseId: true, steps: true, preconditions: true, caseVersion: true, run: { select: { number: true, createdAt: true } }, _count: { select: { results: true } } },
  });
  const tested = new Set(earlier.filter((e) => e._count.results > 0).map((e) => e.caseId));
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
export async function caseNewsCounts(runIds: string[]) {
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

/**
 * Start a run's Pick cases: which library cases are new (never run with a result) or updated
 * (steps or preconditions edited since the last run that had them), by case id.
 */
export async function libraryCaseNews(caseIds: string[]) {
  const out: Record<string, "new" | "updated"> = {};
  if (!caseIds.length) return out;
  const [last, cases] = await Promise.all([
    db.runEntry.findMany({
      where: { caseId: { in: caseIds } },
      orderBy: { run: { createdAt: "desc" } },
      distinct: ["caseId"],
      select: { caseId: true, caseVersion: true },
    }),
    db.testCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, currentVersion: true } }),
  ]);
  const tested = new Set(
    (await db.testResult.findMany({ where: { caseId: { in: caseIds } }, distinct: ["caseId"], select: { caseId: true } })).map((r) => r.caseId),
  );
  const lastOf = new Map(last.map((l) => [l.caseId, l.caseVersion]));
  const edited = cases.filter((c) => tested.has(c.id) && (lastOf.get(c.id) ?? c.currentVersion) < c.currentVersion);
  const vs = edited.length
    ? await db.caseVersion.findMany({
        where: { OR: edited.map((c) => ({ caseId: c.id, version: { in: [lastOf.get(c.id)!, c.currentVersion] } })) },
        select: { caseId: true, version: true, steps: true, preconditions: true },
      })
    : [];
  for (const id of caseIds) if (!tested.has(id)) out[id] = "new";
  for (const c of edited) {
    const a = vs.find((v) => v.caseId === c.id && v.version === lastOf.get(c.id));
    const b = vs.find((v) => v.caseId === c.id && v.version === c.currentVersion);
    if (a && b && (JSON.stringify(a.steps) !== JSON.stringify(b.steps) || a.preconditions.trim() !== b.preconditions.trim())) out[c.id] = "updated";
  }
  return out;
}
