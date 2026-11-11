import "server-only";
import { Prisma, type ResultStatus } from "@prisma/client";
import { db } from "./db";
import { parseSessionLog } from "./charter";
import { SESSION_BUG_CAP, streaks, type GameStats } from "./game";
import { questRecordFor, questRecordsFor } from "./quest-data";
import { glossaryStatsFrom } from "./glossary";
import { glossaryWork } from "./glossary-data";
import { NOT_PRACTICE } from "./practice";

const VERDICTS: ResultStatus[] = ["PASSED", "FAILED", "BLOCKED", "EXPLORED"];

type Shared = {
  users: Promise<Map<string, { xpSince: Date | null; earlyAdopter: boolean }>>;
  workspace: Promise<Awaited<ReturnType<typeof db.workspace.findUnique>>>;
  quests: Promise<Map<string, Awaited<ReturnType<typeof questRecordFor>>>>;
  glossary: Promise<Awaited<ReturnType<typeof glossaryWork>>>;
};

/**
 * Everyone's XP numbers at once (the Workspace Game admin card). Lookups that are the
 * same for everyone, and each run's quest map, are done once and shared; the numbers match
 * gameStats for each person (npm run check:xp checks).
 */
export async function gameStatsMany(userIds: string[]): Promise<Map<string, GameStats>> {
  const shared: Shared = {
    users: db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, xpSince: true, earlyAdopter: true } }).then((rows) => new Map(rows.map((u) => [u.id, u]))),
    workspace: db.workspace.findUnique({ where: { id: 1 } }).then((w) => w),
    quests: questRecordsFor(userIds),
    // Every term with a meaning; glossaryStatsFrom keeps only the ones each person wrote.
    glossary: glossaryWork().then((rows) => rows),
  };
  // Keep a failed shared lookup from showing up as an unhandled rejection before it's awaited.
  for (const p of Object.values(shared)) (p as Promise<unknown>).catch(() => {});
  const stats = await Promise.all(userIds.map((id) => gameStats(id, shared)));
  return new Map(userIds.map((id, i) => [id, stats[i]]));
}

/** Everything one person's XP is made of, across all projects. */
export async function gameStats(userId: string, shared?: Shared): Promise<GameStats> {
  const [user, workspace] = await Promise.all([
    shared
      ? shared.users.then((m) => {
          const u = m.get(userId);
          if (!u) throw new Error(`No user ${userId}`);
          return u;
        })
      : db.user.findUniqueOrThrow({ where: { id: userId }, select: { xpSince: true, earlyAdopter: true } }),
    shared ? shared.workspace : db.workspace.findUnique({ where: { id: 1 } }),
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

  // Everything that only needs the dates above goes in one wave, instead of one after another.
  // Only bugs filed here from a run count; linked Jira issues and sheet imports don't.
  const myBugs = { createdById: userId, project: NOT_PRACTICE, filed: true, createdAt: since, status: { not: "WONT_FIX" as const }, links: { some: {} } };
  const [mine, written, bugFiled, bugFixed, sessions, authored, sharedUsed, suitesRun, glossaryRows] = await Promise.all([
    db.testResult.findMany({
      // Results brought in by Import a run belong to the sheet, not the importer.
      where: { testerId: userId, status: { in: VERDICTS }, imported: false, createdAt: since, run: { project: NOT_PRACTICE } },
      select: { entryId: true, runId: true, caseId: true, status: true, createdAt: true },
    }),
    db.caseVersion.findMany({
      where: { authorId: userId, version: 1, createdAt: newCase, NOT: { changeNote: { startsWith: "Imported from" } } },
      select: { caseId: true },
    }),
    db.defect.count({ where: myBugs }),
    // Fixed means Jira says done, or someone other than the filer marked it Fixed or Closed.
    db.defect.count({
      where: {
        ...myBugs,
        OR: [{ externalCategory: "done" }, { status: { in: ["FIXED", "CLOSED"] }, fixedById: { not: userId } }],
      },
    }),
    db.testResult.findMany({
      where: { testerId: userId, imported: false, createdAt: since, sessionLog: { not: Prisma.AnyNull }, run: { project: NOT_PRACTICE } },
      select: { sessionLog: true },
    }),
    // Writing and looking after cases. Imported cases and restores don't count as writing.
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
    // Glossary: terms whose meaning you wrote, and teammates who opened them.
    shared ? shared.glossary : glossaryWork({ OR: [{ createdById: userId }, { answeredById: userId }] }),
  ]);

  const entries = new Set(mine.map((r) => r.entryId));
  const runIds = [...new Set(mine.map((r) => r.runId))];
  // A failure counts as a caught regression when the same case passed in an earlier run.
  const failures = mine.filter((r) => r.status === "FAILED");
  const failedCases = [...new Set(failures.map((r) => r.caseId))];
  const [passes, ranByOthers, runCompleted, quests] = await Promise.all([
    failedCases.length
      ? db.testResult.findMany({
          // Only passes from before the last failure can count.
          where: { caseId: { in: failedCases }, status: "PASSED", createdAt: { lt: new Date(Math.max(...failures.map((f) => f.createdAt.getTime()))) } },
          select: { caseId: true, runId: true, createdAt: true },
        })
      : [],
    written.length
      ? db.testResult.findMany({
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
      : [],
    runIds.length ? db.testRun.count({ where: { id: { in: runIds }, state: "COMPLETED" } }) : 0,
    // Quest map rescues (Field Medic); no XP, they only unlock the title.
    mine.length ? (shared ? shared.quests.then((m) => m.get(userId) ?? null) : questRecordFor(userId)) : null,
  ]);
  const caught = new Set(failures.filter((f) => passedBefore(passes, f)).map((f) => `${f.runId}:${f.caseId}`));
  const sessionBug = sessions.reduce((sum, r) => sum + Math.min(SESSION_BUG_CAP, parseSessionLog(r.sessionLog).filter((n) => n.kind === "bug").length), 0);
  const caseCreated = authored.filter((v) => v.version === 1 && !v.testCase.archived && Array.isArray(v.steps) && v.steps.length > 0).length;
  const caseImproved = new Set(authored.filter((v) => v.version > 1).map((v) => `${v.caseId}:${v.createdAt.toISOString().slice(0, 10)}`)).size;

  const s = streaks(mine.map((r) => r.createdAt.toISOString().slice(0, 10)));
  const glossary = glossaryStatsFrom(glossaryRows, userId, user.xpSince);

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
    ...glossary,
  };
}

type Pass = { caseId: string; runId: string; createdAt: Date };
const passIndex = new WeakMap<Pass[], Map<string, Pass[]>>();

/**
 * Whether the same case passed in another, earlier run: passes grouped by case once,
 * oldest first, instead of checking every pass against every failure.
 */
function passedBefore(passes: Pass[], f: Pass) {
  let byCase = passIndex.get(passes);
  if (!byCase) {
    byCase = new Map();
    for (const p of passes) {
      const list = byCase.get(p.caseId);
      if (list) list.push(p);
      else byCase.set(p.caseId, [p]);
    }
    for (const list of byCase.values()) list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    passIndex.set(passes, byCase);
  }
  for (const p of byCase.get(f.caseId) ?? []) {
    if (p.createdAt >= f.createdAt) return false;
    if (p.runId !== f.runId) return true;
  }
  return false;
}
