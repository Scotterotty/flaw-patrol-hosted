import "server-only";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { open } from "./crypto";
import { db } from "./db";
import { NOT_BASH_RUN } from "./bash-cases";
import { QaseClient, QaseError, type QaseResult } from "./qase";
import { cameFromUs, matchByTitle, parseStatusMap, QASE_BRING, qaseStatusFor, qaseTime, sentComment } from "./qase-map";

// Qase (ver_164): share a test cycle's results with its Qase run.
//  - Send: each case's newest result made here (by hand, CI or import) goes to Qase once.
//  - Bring: each Qase case's newest result comes into the newest open run that has the
//    case, unless a newer result was already saved here. Newest wins.
// Results remember which tool they came from (fromQase, qaseHash, and the "From Flaw Patrol"
// comment in Qase), so nothing bounces back and forth.

export type QaseSyncOutcome = { ok: true; sent: number; brought: number; linked: number; skipped?: string } | { ok: false; error: string };

/** The most results sent in one sync. The rest go next time. */
const SEND_CAP = 200;
/** Opening a page brings Qase results at most this often per test cycle. */
const PULL_EVERY_MS = 60_000;

const running = new Map<string, Promise<QaseSyncOutcome>>();

/** Sync one test cycle. Calls for the same cycle wait for the one already going, then run. */
export function syncCycle(projectId: string, opts: { send?: boolean; bring?: boolean } = {}): Promise<QaseSyncOutcome> {
  const before = running.get(projectId) ?? Promise.resolve(null);
  const next = before
    .catch(() => null)
    .then(() => doSync(projectId, { send: opts.send ?? true, bring: opts.bring ?? true }))
    .catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
  running.set(projectId, next);
  void next.finally(() => {
    if (running.get(projectId) === next) running.delete(projectId);
  });
  return next;
}

/** After a result is saved: send it to Qase once the response has gone out. */
export function queueQaseSend(projectId: string) {
  later(async () => {
    const on = await db.project.findFirst({ where: { id: projectId, archivedAt: null, group: { archivedAt: null, qase: { send: true } } }, select: { id: true } });
    if (on) await syncCycle(projectId, { bring: false });
  });
}

/** Opening a test cycle or run page: bring Qase results in, at most once a minute. */
export function queueQasePull(projectId: string) {
  later(async () => {
    const p = await db.project.findFirst({ where: { id: projectId, archivedAt: null, group: { archivedAt: null, qase: { isNot: null } } }, select: { qaseSyncedAt: true } });
    if (!p || (p.qaseSyncedAt && Date.now() - p.qaseSyncedAt.getTime() < PULL_EVERY_MS)) return;
    await syncCycle(projectId);
  });
}

/** After the response, where there is one (scripts and tests have none, so nothing is queued). */
function later(fn: () => Promise<void>) {
  try {
    after(() => fn().catch((e) => console.warn("Qase sync failed", e)));
  } catch {
    // Outside a request.
  }
}

/** The test cycles of an umbrella that share with Qase: not archived, with runs. */
export async function sharingCycles(groupId: string) {
  return db.project.findMany({ where: { groupId, archivedAt: null, hubOf: null, runs: { some: NOT_BASH_RUN } }, select: { id: true } });
}

async function doSync(projectId: string, want: { send: boolean; bring: boolean }): Promise<QaseSyncOutcome> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, archivedAt: true, groupId: true, qaseRunId: true, group: { select: { archivedAt: true, qase: true } } },
  });
  const cfg = p?.group?.qase;
  if (!p || !cfg || !p.groupId) return { ok: true, sent: 0, brought: 0, linked: 0, skipped: "Qase isn't set up." };
  if (p.archivedAt || p.group?.archivedAt) return { ok: true, sent: 0, brought: 0, linked: 0, skipped: "Archived test cycles don't share." };
  const send = want.send && cfg.send;
  const bring = want.bring && cfg.bring;
  if (!send && !bring) return { ok: true, sent: 0, brought: 0, linked: 0, skipped: "Sharing is turned off." };
  let token: string;
  try {
    token = open(cfg.tokenEncrypted);
  } catch {
    return fail(projectId, "The saved Qase token can't be read here (it was saved with a different AUTH_SECRET). Paste it again in Settings → Qase.");
  }
  const client = new QaseClient(token);
  const code = cfg.projectCode;
  try {
    const entries = await db.runEntry.findMany({
      where: { run: { projectId, ...NOT_BASH_RUN } },
      select: {
        id: true,
        caseId: true,
        caseVersion: true,
        steps: true,
        lastTestedAt: true,
        run: { select: { id: true, state: true, number: true, automated: true } },
        testCase: { select: { id: true, title: true, qaseId: true } },
        results: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, comment: true, testerName: true, elapsedSec: true, durationMs: true, fromQase: true, qaseHash: true, createdAt: true } },
      },
    });

    // New cases in the cycle link by title, like on Link cases.
    let linked = 0;
    const unlinked = [...new Map(entries.filter((e) => e.testCase.qaseId === null).map((e) => [e.caseId, e.testCase])).values()];
    if (unlinked.length) {
      const qaseCases = await client.cases(code);
      const taken = new Set((await db.testCase.findMany({ where: { project: { OR: [{ groupId: p.groupId }, { hubOf: { id: p.groupId } }] }, qaseId: { gt: 0 } }, select: { qaseId: true } })).map((c) => c.qaseId!));
      const hits = matchByTitle(unlinked, qaseCases, taken);
      for (const [caseId, qaseId] of hits) {
        await db.testCase.update({ where: { id: caseId }, data: { qaseId } });
        for (const e of entries) if (e.caseId === caseId) e.testCase.qaseId = qaseId;
        linked++;
      }
    }

    const linkedIds = [...new Set(entries.map((e) => e.testCase.qaseId ?? 0).filter((id) => id > 0))];
    let runId = p.qaseRunId;
    if (!runId) {
      if (!linkedIds.length) return done(projectId, { sent: 0, brought: 0, linked, skipped: "None of this test cycle's cases are linked to Qase yet." });
      runId = await client.createRun(code, p.name, linkedIds);
      await db.project.update({ where: { id: projectId }, data: { qaseRunId: runId, qaseRunTitle: p.name } });
    }

    let sent = 0;
    if (send) {
      const map = parseStatusMap(cfg.statusMap);
      const outbox = entries
        .flatMap((e) => {
          const r = e.results[0];
          const status = r ? qaseStatusFor(r.status, map) : null;
          return r && status && !r.fromQase && !r.qaseHash && (e.testCase.qaseId ?? 0) > 0 ? [{ r, status, caseId: e.testCase.qaseId! }] : [];
        })
        .sort((a, b) => a.r.createdAt.getTime() - b.r.createdAt.getTime())
        .slice(0, SEND_CAP);
      for (const o of outbox) {
        const ms = o.r.durationMs ?? (o.r.elapsedSec ? o.r.elapsedSec * 1000 : null);
        const hash = await client.addResult(code, runId, { caseId: o.caseId, status: o.status, comment: sentComment(o.r.testerName, o.r.comment), timeMs: ms });
        await db.testResult.update({ where: { id: o.r.id }, data: { qaseHash: hash || `sent:${o.r.id}` } });
        sent++;
      }
    }

    let brought = 0;
    if (bring) brought = await bringResults(projectId, await client.results(code, runId), entries);
    return done(projectId, { sent, brought, linked });
  } catch (e) {
    if (e instanceof QaseError) return fail(projectId, e.message);
    throw e;
  }
}

type EntryRow = {
  id: string;
  caseId: string;
  caseVersion: number;
  steps: unknown;
  lastTestedAt: Date | null;
  run: { id: string; state: string; number: number; automated: boolean };
  testCase: { qaseId: number | null };
};

/** Qase results not seen before go into the newest open run with the case, when they're newer. */
async function bringResults(projectId: string, results: QaseResult[], entries: EntryRow[]) {
  const fresh = results.filter((r) => r.hash && !cameFromUs(r.comment) && QASE_BRING[r.status]);
  if (!fresh.length) return 0;
  const known = new Set(
    (await db.testResult.findMany({ where: { qaseHash: { in: fresh.map((r) => r.hash) }, run: { projectId } }, select: { qaseHash: true } })).map((r) => r.qaseHash),
  );
  // Each Qase case's newest result only: older ones would be replaced straight away.
  const newest = new Map<number, { r: QaseResult; at: Date }>();
  for (const r of fresh) {
    const at = qaseTime(r.endTime) ?? new Date();
    const had = newest.get(r.caseId);
    if (!had || at > had.at) newest.set(r.caseId, { r, at });
  }
  let n = 0;
  for (const { r, at } of newest.values()) {
    if (known.has(r.hash)) continue;
    // The newest open run that has the case, and isn't automation.
    const target = entries.filter((e) => e.testCase.qaseId === r.caseId && e.run.state === "ACTIVE" && !e.run.automated).sort((a, b) => b.run.number - a.run.number)[0];
    if (!target) continue;
    if (target.lastTestedAt && target.lastTestedAt >= at) continue;
    const status = QASE_BRING[r.status];
    const steps = Array.isArray(target.steps) ? target.steps : [];
    const stepStatus = status === "PASSED" || status === "SKIPPED" ? status : "UNTESTED";
    await db.$transaction(async (tx) => {
      await tx.testResult.create({
        data: {
          entryId: target.id,
          runId: target.run.id,
          caseId: target.caseId,
          caseVersion: target.caseVersion,
          status,
          stepResults: steps.map(() => ({ status: stepStatus, actual: "" })) as Prisma.InputJsonValue,
          comment: r.comment.slice(0, 10000),
          testerName: "Qase",
          imported: true,
          fromQase: true,
          qaseHash: r.hash,
        },
      });
      await tx.runEntry.update({ where: { id: target.id }, data: { status, lastTestedAt: at, draft: Prisma.DbNull, draftAt: null, draftByName: "", draftById: null } });
    });
    target.lastTestedAt = at;
    n++;
  }
  return n;
}

async function done(projectId: string, out: { sent: number; brought: number; linked: number; skipped?: string }): Promise<QaseSyncOutcome> {
  await db.project.update({ where: { id: projectId }, data: { qaseSyncedAt: new Date(), qaseError: "" } });
  return { ok: true, ...out };
}

async function fail(projectId: string, error: string): Promise<QaseSyncOutcome> {
  await db.project.update({ where: { id: projectId }, data: { qaseSyncedAt: new Date(), qaseError: error } });
  return { ok: false, error };
}
