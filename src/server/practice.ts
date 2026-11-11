"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { PRACTICE_CASES } from "@/lib/practice";
import { myPractice, sweepPractice } from "@/lib/practice-data";
import { requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A key nobody uses yet, like TRYQKX. Case keys read TRYQKX-1. */
async function freePracticeKey() {
  for (let i = 0; i < 20; i++) {
    const key = `TRY${Array.from({ length: 3 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("")}`;
    if (!(await db.project.findUnique({ where: { key }, select: { id: true } }))) return key;
  }
  throw new UserError("Couldn't set up the practice run. Try again.");
}

/**
 * Try it on Start here (ver_217): a private practice run with three sample cases, for you only.
 * Opening it again picks up the same one. It isn't in any umbrella, so it stays out of reports,
 * quest maps, Jira and Slack, and it's removed after 7 days (or with Remove practice run).
 */
export async function startPracticeRun() {
  return attempt(async () => {
    const user = await requireUser();
    const have = await myPractice(user.id);
    if (have) return { href: have.href };
    await sweepPractice();
    const key = await freePracticeKey();
    const author = { authorName: "Flaw Patrol" };
    const number = await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          key,
          name: "Practice run",
          description: "Only you see this. It goes away on its own after 7 days.",
          practiceFor: user.id,
          slackMode: "off",
          emailDigestMode: "off",
          caseSeq: PRACTICE_CASES.length,
          runSeq: 1,
          members: { create: { userId: user.id, role: "TESTER" } },
        },
      });
      const ids: string[] = [];
      for (const [i, c] of PRACTICE_CASES.entries()) {
        const steps = c.steps.map((s) => ({ kind: "step" as const, ...s })) as Prisma.InputJsonValue;
        const made = await tx.testCase.create({
          data: {
            projectId: project.id,
            number: i + 1,
            title: c.title,
            preconditions: c.preconditions,
            priority: "MEDIUM",
            runBefore: true,
            versions: { create: { version: 1, title: c.title, preconditions: c.preconditions, priority: "MEDIUM", type: "MANUAL", tags: [], steps, changeNote: "Practice case", ...author } },
          },
          select: { id: true },
        });
        ids.push(made.id);
      }
      const entries = await buildEntries(tx, project.id, ids, null);
      const run = await tx.testRun.create({
        data: {
          projectId: project.id,
          number: 1,
          name: "Practice run",
          description: "Three sample cases. Only you see this run.",
          createdById: user.id,
          createdBy: user.name ?? user.email,
          entries: { create: entries.map(({ assigneeId, ...e }) => ({ ...e, assigneeId: assigneeId ?? user.id })) },
        },
        select: { number: true },
      });
      return run.number;
    });
    revalidatePath("/", "layout");
    return { href: `/p/${key}/runs/${number}/execute` };
  });
}

/** Remove practice run: everything in it goes, cases, results and bugs. */
export async function removePracticeRun() {
  return attempt(async () => {
    const user = await requireUser();
    await db.project.deleteMany({ where: { practiceFor: user.id } });
    revalidatePath("/", "layout");
    return {};
  });
}
