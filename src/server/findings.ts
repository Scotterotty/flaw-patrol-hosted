"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseSessionLog } from "@/lib/charter";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

/** Record (or change) the answer to a question logged in a session. Empty text reopens it. */
export async function answerQuestion(projectId: string, resultId: string, noteId: string, text: string) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:execute");
    const answer = z.string().trim().max(2000).parse(text);
    const result = await db.testResult.findFirst({ where: { id: resultId, run: { projectId } }, select: { sessionLog: true } });
    const note = result && parseSessionLog(result.sessionLog).find((n) => n.id === noteId);
    if (!note || note.kind !== "question") throw new UserError("That question no longer exists.");
    if (!answer) {
      await db.sessionAnswer.deleteMany({ where: { resultId, noteId } });
    } else {
      const by = { text: answer, answeredById: user.id, answeredBy: user.name ?? user.email };
      await db.sessionAnswer.upsert({ where: { resultId_noteId: { resultId, noteId } }, create: { resultId, noteId, ...by }, update: { ...by, createdAt: new Date() } });
    }
    revalidatePath(`/p/${project.key}/reports`);
    return {};
  });
}
