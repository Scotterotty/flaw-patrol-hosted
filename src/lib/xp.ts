import "server-only";
import { Prisma, type ResultStatus } from "@prisma/client";
import { db } from "./db";
import { parseSessionLog } from "./charter";
import { SESSION_BUG_CAP, streaks, type GameStats } from "./game";
import { questRecordFor } from "./quest-data";

const VERDICTS: ResultStatus[] = ["PASSED", "FAILED", "BLOCKED", "EXPLORED"];

/** Everything one person's XP is made of, across all projects. */
export async function gameStats(userId: string): Promise<GameStats> {
  const [user, workspace] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { xpSince: true, earlyAdopter: true } }),
    db.workspace.findUnique({ where: { id: 1 } }),
  ]);
  // After an admin resets someone, only work from then on counts.
  const since = user.xpSince ? { gte: user.xpSince } : undefined;
  // Writing cases, shared steps and suites only counts from ver_70 on, so nobody gets XP for cases
  // that were already in Flaw Patrol (often written by someone else and added by whoever set it up).
  const cutoffs = [user.xpSince, workspace?.xpAuthoringSince].filter((d): d is Date => !!d);
  const authoredSince = cutoffs.length ? { gte: new Date(Math.max(...cutoffs.map((d) => d.getTime()))) } : undefined;
  const newCase = workspace?.xpAuthoringSince ? { gte: workspace.xpAuthoringSince } : undefined;
  // Before launch everyone who signs in is an early adopter; after it, those who had.
  const earlyAdopter = user.earlyAdopter || !workspace?.launchedAt ? 1 : 0;

  const mine = await db.testResult.findMany({
    // Results brought in by Import a run belong to the sheet, not the importer.
    where: { testerId: userId, status: { in: VERDICTS }, imported: false, createdAt: since },
    select: {
      entryId: true,
      runId: true,
      caseId: true,
      status: true,
      createdAt: true,
    },
  });

  const entries = new Set(mine.map((r) => r.entryId));
  const runIds = [...new Set(mine.map((r) => r.runId))];

  // A failure counts as a caught regression when the same case passed in an earlier run.
  const failures = mine.filter((r) => r.status === "FAILED");
  const passes = failures.length
    ? await db.testResult.findMany({
        where: {
          caseId: { in: [...new Set(failures.map((r) => r.caseId))] },
          status: "PASSED",
        },
        select: { caseId: true, runId: true, createdAt: true },
      })
    : [];
  const caught = new Set(
    failures.filter((f) => passes.some((p) => p.caseId === f.caseId && p.runId !== f.runId && p.createdAt < f.createdAt)).map((f) => `${f.runId}:${f.caseId}`),
  );

  const written = await db.caseVersion.findMany({
    where: { authorId: userId, version: 1, createdAt: newCase, NOT: { changeNote: { startsWith: "Imported from" } } },
    select: { caseId: true },
  });
  const ranByOthers = written.length
    ? await db.testResult.findMany({
        where: {
          caseId: { in: written.map((w) => w.caseId) },
          testerId: { not: userId },
          status: { in: VERDICTS },
          imported: false,
          createdAt: since,
        },
        distinct: ["caseId"],
        select: { caseId: true },
      })
    : [];

  // Only bugs filed here from a run count; linked Jira issues and sheet imports don't.
  const myBugs = { createdById: userId, filed: true, createdAt: since, status: { not: "WONT_FIX" as const }, links: { some: {} } };
  const [runCompleted, bugFiled, bugFixed, sessions] = await Promise.all([
    runIds.length ? db.testRun.count({ where: { id: { in: runIds }, state: "COMPLETED" } }) : 0,
    db.defect.count({ where: myBugs }),
    // Fixed means Jira says done, or someone other than the filer marked it Fixed or Closed.
    db.defect.count({
      where: {
        ...myBugs,
        OR: [{ externalCategory: "done" }, { status: { in: ["FIXED", "CLOSED"] }, fixedById: { not: userId } }],
      },
    }),
    db.testResult.findMany({
      where: { testerId: userId, imported: false, createdAt: since, sessionLog: { not: Prisma.AnyNull } },
      select: { sessionLog: true },
    }),
  ]);
  const sessionBug = sessions.reduce((sum, r) => sum + Math.min(SESSION_BUG_CAP, parseSessionLog(r.sessionLog).filter((n) => n.kind === "bug").length), 0);

  // Writing and looking after cases. Imported cases and restores don't count as writing.
  const [authored, sharedUsed, suitesRun] = await Promise.all([
    db.caseVersion.findMany({
      where: { authorId: userId, createdAt: authoredSince, NOT: [{ changeNote: { startsWith: "Imported from" } }, { changeNote: { startsWith: "Restored version" } }] },
      select: { caseId: true, version: true, steps: true, createdAt: true, testCase: { select: { archived: true } } },
    }),
    db.sharedStepVersion.findMany({
      where: { authorId: userId, version: 1, createdAt: authoredSince, sharedStep: { archived: false, usages: { some: {} } } },
      select: { sharedStepId: true },
    }),
    db.suiteVersion.findMany({
      where: { authorId: userId, version: 1, createdAt: authoredSince, suite: { runs: { some: {} } } },
      select: { suiteId: true },
    }),
  ]);
  const caseCreated = authored.filter((v) => v.version === 1 && !v.testCase.archived && Array.isArray(v.steps) && v.steps.length > 0).length;
  const caseImproved = new Set(authored.filter((v) => v.version > 1).map((v) => `${v.caseId}:${v.createdAt.toISOString().slice(0, 10)}`)).size;

  const s = streaks(mine.map((r) => r.createdAt.toISOString().slice(0, 10)));
  // Quest map rescues (Field Medic); no XP, they only unlock the title.
  const quests = mine.length ? await questRecordFor(userId) : null;

  return {
    verdict: entries.size,
    runCompleted,
    bugFiled,
    bugFixed,
    sessionBug,
    regression: caught.size,
    caseRunByOthers: ranByOthers.length,
    caseCreated,
    caseImproved,
    sharedStepUsed: sharedUsed.length,
    suiteRun: suitesRun.length,
    streakDay: s.continued,
    bestStreak: s.best,
    currentStreak: s.current,
    earlyAdopter,
    rescues: quests?.rescues ?? 0,
  };
}
