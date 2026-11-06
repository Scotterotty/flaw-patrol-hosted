import "server-only";
import { runTitle } from "./run-label";
import { changeSummary, stepChanges, type CaseNews } from "./case-news";
import { db } from "./db";
import type { ExpandedStep } from "./steps";

// New and Updated cases in a run. New: the case never had a result saved in an
// earlier run, and wasn't marked as run before Flaw Patrol. Updated: its steps or preconditions differ from the copy its last earlier run used.

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
    select: { caseId: true, steps: true, preconditions: true, caseVersion: true, run: { select: { number: true, name: true, build: true, createdAt: true } }, _count: { select: { results: true } } },
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
      since: { run: last.run.number, label: runTitle(last.run), at: last.run.createdAt.toISOString(), version: last.caseVersion },
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

/**
 * New and Updated counts for the Test runs list, open runs only. ver_129: every run at once, in
 * two lookups that compare fingerprints of the steps in the database instead of loading every
 * step of every case run by run. Steps are only loaded for the few cases whose fingerprint
 * changed, to tell real edits apart, so the counts match caseNewsForRun exactly.
 */
export async function caseNewsCounts(runIds: string[]) {
  const out = new Map<string, { new: number; updated: number }>();
  if (!runIds.length) return out;
  type Row = { id: string; runId: string; caseId: string; at: Date; hash: string; preconditions: string };
  const [entries, earlier] = await Promise.all([
    db.$queryRaw<(Row & { runBefore: boolean })[]>`
      select e.id, e."runId", e."caseId", r."createdAt" as at, md5(e.steps::text) as hash, e.preconditions, c."runBefore"
      from "RunEntry" e join "TestRun" r on r.id = e."runId" join "TestCase" c on c.id = e."caseId"
      where e."runId" = any(${runIds})`,
    // Every other run's copy of those cases, newest first, and whether anyone saved a result on it.
    db.$queryRaw<(Row & { tested: boolean })[]>`
      select x.id, x."runId", x."caseId", xr."createdAt" as at, md5(x.steps::text) as hash, x.preconditions,
        exists (select 1 from "TestResult" t where t."entryId" = x.id) as tested
      from "RunEntry" x join "TestRun" xr on xr.id = x."runId"
      where x."caseId" in (select "caseId" from "RunEntry" where "runId" = any(${runIds}))
      order by xr."createdAt" desc`,
  ]);
  const byCase = new Map<string, (typeof earlier)[number][]>();
  for (const x of earlier) {
    const list = byCase.get(x.caseId) ?? [];
    list.push(x);
    byCase.set(x.caseId, list);
  }
  const counts = new Map<string, { new: number; updated: number }>();
  const bump = (runId: string, kind: "new" | "updated") => {
    const c = counts.get(runId) ?? { new: 0, updated: 0 };
    c[kind]++;
    counts.set(runId, c);
  };
  // Same steps fingerprint: nothing changed. Different: load both copies' steps below.
  const check: [runId: string, now: string, before: string][] = [];
  for (const e of entries) {
    const before = (byCase.get(e.caseId) ?? []).filter((x) => x.runId !== e.runId && x.at < e.at);
    if (!e.runBefore && !before.some((x) => x.tested)) {
      bump(e.runId, "new");
      continue;
    }
    const last = before[0];
    if (!last) continue;
    if (last.preconditions.trim() !== e.preconditions.trim()) bump(e.runId, "updated");
    else if (last.hash !== e.hash) check.push([e.runId, e.id, last.id]);
  }
  if (check.length) {
    const steps = new Map(
      (await db.runEntry.findMany({ where: { id: { in: [...new Set(check.flatMap(([, a, b]) => [a, b]))] } }, select: { id: true, steps: true } })).map((r) => [r.id, asSteps(r.steps)]),
    );
    for (const [runId, now, before] of check) {
      const { steps: changed, removed } = stepChanges(steps.get(before) ?? [], steps.get(now) ?? []);
      if (Object.keys(changed).length || removed) bump(runId, "updated");
    }
  }
  for (const [id, c] of counts) if (c.new || c.updated) out.set(id, c);
  return out;
}

/**
 * Create a run's Pick cases: which library cases are new (never run with a result) or updated
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
    db.testCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, currentVersion: true, runBefore: true } }),
  ]);
  const tested = new Set(
    (await db.testResult.findMany({ where: { caseId: { in: caseIds } }, distinct: ["caseId"], select: { caseId: true } })).map((r) => r.caseId),
  );
  for (const c of cases) if (c.runBefore) tested.add(c.id);
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
