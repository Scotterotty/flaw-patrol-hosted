import { Prisma, type ResultStatus } from "@prisma/client";
import { db } from "./db";
import { clientOfRow, clientResults } from "./clients";
import { caseKey } from "./format";
import { parseDraft, draftSchema } from "./run-draft";
import { runTitle } from "./run-label";
import { fillStatus, linkedIndexes, parseSisterFill, planFill, type Disagree, type FillMark, type SisterFill } from "./sisters";
import { headingRows } from "./step-checks";
import { deriveCaseStatus } from "./status";
import { parseTestData } from "./test-data";

// Sister cases (server side): when a dry run case gets a result, fill the linked steps of its
// sister cases in open runs. Only steps nobody marked are filled; a different result already there
// is noted on the case, never changed. Not a server action: only other server code calls it.

export type FillItem = { entryId: string; projectKey: string; runNumber: number; title: string; where: string; steps: number; status: ResultStatus };
export type FillSummary = { items: FillItem[]; disagree: number; at: string | null };

type Who = { id: string; name: string };
type StepResult = { status: ResultStatus; actual: string; checks?: ResultStatus[] };

const NONE: FillSummary = { items: [], disagree: 0, at: null };
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** Two runs go together unless both name a release and the releases differ. */
export const releasesFit = (a: string, b: string) => !a.trim() || !b.trim() || same(a, b);

/** The step results a run's copy of a case has now: its draft, else its last result, else none. */
function currentSteps(entry: { status: ResultStatus; draft: unknown; steps: unknown }, last: { stepResults: unknown } | undefined): StepResult[] {
  const n = Array.isArray(entry.steps) ? entry.steps.length : 0;
  const draft = entry.status === "IN_PROGRESS" ? parseDraft(entry.draft) : null;
  if (draft && draft.stepResults.length === n) return draft.stepResults as StepResult[];
  const fromLast = Array.isArray(last?.stepResults) && last.stepResults.length === n ? (last.stepResults as StepResult[]) : null;
  return fromLast?.map((s) => ({ status: s.status, actual: s.actual ?? "", ...(s.checks ? { checks: s.checks } : {}) })) ?? Array.from({ length: n }, () => ({ status: "UNTESTED" as ResultStatus, actual: "" }));
}

/**
 * Fill the sister cases of a dry run case from this run's copy of it.
 * `onlyClients`: just these clients' links (the run page grid marks one client at a time).
 * `onlyRunId`: just this target run (a run that has just started).
 */
export async function fillSisters(fromEntryId: string, who: Who, opts: { onlyClients?: string[]; onlyRunId?: string } = {}): Promise<FillSummary> {
  const entry = await db.runEntry.findUnique({
    where: { id: fromEntryId },
    include: {
      run: { select: { id: true, name: true, build: true, release: true, createdAt: true } },
      testCase: { select: { id: true, number: true, project: { select: { key: true } } } },
      results: { orderBy: { createdAt: "desc" }, take: 1, include: { defects: { include: { defect: { select: { number: true, externalKey: true } } } } } },
    },
  });
  if (!entry) return NONE;
  const links = await db.sisterLink.findMany({ where: { fromCaseId: entry.caseId } });
  if (!links.length) return NONE;

  const last = entry.results[0];
  const steps = Array.isArray(entry.steps) ? (entry.steps as { row?: number }[]) : [];
  const now = currentSteps(entry, last);
  const statuses = now.map((s) => s.status);
  const data = parseTestData(entry.testData);
  const rowOf = steps.map((s) => s?.row);
  const byClient = entry.clients.length ? clientResults(entry.clients, data, rowOf, statuses) : {};
  const final = entry.status !== "UNTESTED" && entry.status !== "IN_PROGRESS";
  const draft = entry.status === "IN_PROGRESS" ? parseDraft(entry.draft) : null;
  // Bugs on the dry run result (or its draft), with the step they sit on.
  const bugs: { key: string; step: number | null }[] = final
    ? (last?.defects ?? []).map((d) => ({ key: d.defect.externalKey ?? `D-${d.defect.number}`, step: d.stepIndex }))
    : (draft?.defects ?? []).map((d) => ({ key: d.defect.externalKey ?? `D-${d.defect.number}`, step: d.stepIndex }));
  const from = `${caseKey(entry.testCase.project.key, entry.testCase.number)} ${entry.title}`;
  const dryRun = runTitle(entry.run);
  const at = new Date().toISOString();
  const items: FillItem[] = [];
  let disagreeCount = 0;

  for (const link of links) {
    if (opts.onlyClients && !opts.onlyClients.some((c) => same(c, link.fromClient))) continue;
    const client = link.fromClient && entry.clients.some((c) => same(c, link.fromClient)) ? entry.clients.find((c) => same(c, link.fromClient))! : "";
    // A client the dry run doesn't test this case on gives nothing.
    if (link.fromClient && !client && entry.clients.length) continue;
    const status = fillStatus(client ? byClient[client] : final ? (last?.status ?? entry.status) : null);
    if (!status) continue;
    const mine = (i: number | null) => i === null || !client || clientOfRow(entry.clients, data, rowOf[i]) === client;
    const mark: FillMark = { status, by: who.name, byId: who.id, at, from: client ? `${from} · ${client}` : from, run: dryRun, bugs: [...new Set(bugs.filter((b) => mine(b.step)).map((b) => b.key))] };

    // Open runs with the sister case: the newest one in each test cycle, same release when both say one.
    const found = await db.runEntry.findMany({
      where: {
        caseId: link.toCaseId,
        run: { state: "ACTIVE", automated: false, NOT: { kind: "bash" }, ...(opts.onlyRunId ? { id: opts.onlyRunId } : { id: { not: entry.runId } }) },
      },
      select: { id: true, run: { select: { id: true, number: true, name: true, build: true, release: true, createdAt: true, projectId: true, project: { select: { key: true, name: true } } } } },
    });
    const newest = new Map<string, (typeof found)[number]>();
    for (const t of found) {
      if (!releasesFit(entry.run.release, t.run.release)) continue;
      const had = newest.get(t.run.projectId);
      if (!had || had.run.createdAt < t.run.createdAt) newest.set(t.run.projectId, t);
    }
    for (const t of newest.values()) {
      const done = await fillOne(t.id, link.steps, mark, who);
      if (!done) continue;
      disagreeCount += done.disagree;
      if (done.filled) items.push({ entryId: t.id, projectKey: t.run.project.key, runNumber: t.run.number, title: done.title, where: `${t.run.project.name} · ${runTitle(t.run)}`, steps: done.filled, status });
    }
  }
  return { items, disagree: disagreeCount, at: items.length ? at : null };
}

/** Fill one run's copy of a sister case. Returns how many steps filled and disagreed. */
async function fillOne(entryId: string, keys: string[], mark: FillMark, who: Who) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RunEntry" WHERE id = ${entryId} FOR UPDATE`;
    const e = await tx.runEntry.findUnique({ where: { id: entryId }, include: { results: { orderBy: { createdAt: "desc" }, take: 1 }, run: { select: { state: true } } } });
    if (!e || e.run.state !== "ACTIVE") return null;
    const headings = headingRows(e.steps);
    const steps = (Array.isArray(e.steps) ? e.steps : []) as { action?: string; expected?: string }[];
    const idx = linkedIndexes(steps, keys, headings);
    if (!idx.length) return null;
    const base = currentSteps(e, e.results[0]);
    const plan = planFill(
      base.map((s) => s.status),
      idx,
      mark.status,
    );
    if (!plan.filled.length && !plan.disagree.length) return null;
    const fill: SisterFill = parseSisterFill(e.sisterFill) ?? { steps: {}, disagree: [] };
    if (plan.disagree.length) {
      const d: Disagree = { steps: plan.disagree, says: mark.status, from: mark.from, run: mark.run, by: mark.by, at: mark.at };
      fill.disagree = [...fill.disagree.filter((x) => x.from !== mark.from), d];
    }
    if (plan.filled.length) {
      const next = base.map((s, i) => (plan.filled.includes(i) ? { ...s, status: plan.next[i] } : s));
      const open = next.filter((_, i) => !headings.has(i)).map((s) => s.status);
      if (open.every((s) => s !== "UNTESTED" && s !== "IN_PROGRESS")) {
        // Every step has a result now: save it, as if someone pressed Save.
        const status = deriveCaseStatus(open);
        const result = await tx.testResult.create({
          data: {
            entryId: e.id,
            runId: e.runId,
            caseId: e.caseId,
            caseVersion: e.caseVersion,
            status,
            stepResults: next as unknown as Prisma.InputJsonValue,
            comment: `Filled in from the dry run: ${mark.from} (${mark.run}).`,
            testerId: who.id,
            testerName: who.name,
            // Tested in the dry run, so it earns nothing here.
            imported: true,
          },
        });
        for (const i of plan.filled) fill.steps[i] = { ...mark, resultId: result.id };
        await tx.runEntry.update({ where: { id: e.id }, data: { status, lastTestedAt: new Date(), draft: Prisma.DbNull, draftAt: null, draftByName: "", draftById: null, sisterFill: fill as unknown as Prisma.InputJsonValue } });
      } else {
        const old = e.status === "IN_PROGRESS" ? parseDraft(e.draft) : null;
        const draft = { ...(old ?? draftSchema.parse({ stepResults: [] })), stepResults: next };
        for (const i of plan.filled) fill.steps[i] = mark;
        // The draft keeps whoever was on the case: filling isn't someone testing it.
        await tx.runEntry.update({ where: { id: e.id }, data: { status: "IN_PROGRESS", draft: draft as unknown as Prisma.InputJsonValue, sisterFill: fill as unknown as Prisma.InputJsonValue } });
      }
    } else {
      await tx.runEntry.update({ where: { id: e.id }, data: { sisterFill: fill as unknown as Prisma.InputJsonValue } });
    }
    return { title: e.title, filled: plan.filled.length, disagree: plan.disagree.length };
  });
}

/** A run that has just started: fill its cases from the newest dry run results of their sisters. */
export async function fillNewRun(runId: string, who: Who): Promise<number> {
  const run = await db.testRun.findUnique({ where: { id: runId }, select: { id: true, release: true, automated: true, kind: true, entries: { select: { caseId: true } } } });
  if (!run || run.automated || run.kind === "bash") return 0;
  const links = await db.sisterLink.findMany({ where: { toCaseId: { in: run.entries.map((e) => e.caseId) } }, select: { fromCaseId: true } });
  let filled = 0;
  for (const fromCaseId of new Set(links.map((l) => l.fromCaseId))) {
    const sources = await db.runEntry.findMany({
      where: { caseId: fromCaseId, runId: { not: run.id }, status: { not: "UNTESTED" }, run: { automated: false } },
      select: { id: true, run: { select: { release: true, createdAt: true } } },
      orderBy: { run: { createdAt: "desc" } },
      take: 20,
    });
    const source = sources.find((s) => releasesFit(s.run.release, run.release));
    if (!source) continue;
    const r = await fillSisters(source.id, who, { onlyRunId: run.id });
    filled += r.items.reduce((n, x) => n + x.steps, 0);
  }
  return filled;
}

/** Does any dry run case link to this one, or this one to any? Cheap check before the work. */
export async function hasSisters(caseId: string) {
  return (await db.sisterLink.count({ where: { OR: [{ fromCaseId: caseId }, { toCaseId: caseId }] } })) > 0;
}

/**
 * Undo a fill: steps it filled go back to no result, where nobody has changed them since.
 * A result the fill saved is taken back while it is still the newest.
 */
export async function undoFill(entryId: string, at: string, who: Who): Promise<number> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RunEntry" WHERE id = ${entryId} FOR UPDATE`;
    const e = await tx.runEntry.findUnique({ where: { id: entryId }, include: { results: { orderBy: { createdAt: "desc" }, take: 2 }, run: { select: { state: true } } } });
    const fill = parseSisterFill(e?.sisterFill);
    if (!e || !fill || e.run.state !== "ACTIVE") return 0;
    const mine = Object.entries(fill.steps).filter(([, m]) => m.at === at && m.byId === who.id);
    fill.disagree = fill.disagree.filter((d) => d.at !== at);
    if (!mine.length) {
      await tx.runEntry.update({ where: { id: e.id }, data: { sisterFill: fill as unknown as Prisma.InputJsonValue } });
      return 0;
    }
    const resultId = mine.find(([, m]) => m.resultId)?.[1].resultId;
    let undone = 0;
    if (resultId && e.results[0]?.id === resultId) {
      // The fill saved the newest result: take it back, and the case is as it was before.
      await tx.testResult.delete({ where: { id: resultId } });
      const before = e.results[1];
      await tx.runEntry.update({ where: { id: e.id }, data: { status: before?.status ?? "UNTESTED", lastTestedAt: before?.createdAt ?? null } });
      undone = mine.length;
    } else if (!resultId && e.status === "IN_PROGRESS") {
      const draft = parseDraft(e.draft);
      if (draft) {
        const steps = draft.stepResults.map((s, i) => {
          const m = fill.steps[i];
          if (m && m.at === at && m.byId === who.id && s.status === m.status) {
            undone++;
            return { ...s, status: "UNTESTED" as const };
          }
          return s;
        });
        const empty = steps.every((s) => s.status === "UNTESTED" && !s.actual.trim()) && !draft.comment.trim() && !draft.attachments.length && !draft.defects.length && !draft.override;
        await tx.runEntry.update({
          where: { id: e.id },
          data: empty
            ? { status: e.results[0]?.status ?? "UNTESTED", draft: Prisma.DbNull, draftAt: null, draftByName: "", draftById: null }
            : { draft: { ...draft, stepResults: steps } as unknown as Prisma.InputJsonValue },
        });
      }
    }
    for (const [i] of mine) delete fill.steps[i];
    const left = Object.keys(fill.steps).length || fill.disagree.length;
    await tx.runEntry.update({ where: { id: e.id }, data: { sisterFill: left ? (fill as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
    return undone;
  });
}

/** The dry run test cycles someone can link from: the ones with clients, on teams they're on. */
export async function dryRunCycles(userId: string) {
  return db.project.findMany({
    where: { NOT: { clients: { isEmpty: true } }, archivedAt: null, members: { some: { userId } } },
    select: { id: true, key: true, name: true, clients: true },
    orderBy: { name: "asc" },
  });
}

