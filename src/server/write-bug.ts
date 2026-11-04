"use server";

// Write a bug: a bug that isn't from a test case, a run or a bug bash. It uses the same
// templates and filing as a bug from a run (fileTemplatedBug with no run entry); these
// are the extra pieces the Write a bug box and the Bugs page need.

import { db } from "@/lib/db";
import { foundInRelease } from "@/lib/found-in";
import { SAVED_ID, parseAnswers } from "@/lib/bug-layout";
import { requireProjectAction } from "@/lib/session";
import { jiraConfigFor } from "@/lib/umbrella";
import { fileTemplatedBug } from "./jira";
import { attempt, UserError } from "./result";

/** What the box starts with for a test cycle: the release it's testing and its Jira project, if connected. */
export async function writeBugStart(projectId: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:execute");
    const jira = await jiraConfigFor(project.id);
    return { foundIn: foundInRelease({ run: "", cycle: project.rcName }).name, jiraKey: jira?.jiraProjectKey ?? null };
  });
}

/** Send to Jira: a written bug saved here goes to Jira with its own headings and files. */
export async function sendWrittenBug(projectId: string, defectId: string) {
  const found = await attempt(async () => {
    await requireProjectAction(projectId, "run:execute");
    const defect = await db.defect.findFirst({ where: { id: defectId, projectId } });
    if (!defect) throw new UserError("That bug isn't in this test cycle anymore.");
    const files = await db.attachment.findMany({ where: { defectId: defect.id }, select: { id: true }, orderBy: { createdAt: "asc" } });
    return { defect, files };
  });
  if (!found.ok) return found;
  const { defect, files } = found;
  const answers = parseAnswers(defect.answers);
  // Files under a heading go with their heading; the rest go as the bug's own files.
  const underHeadings = new Set(answers.flatMap((a) => (a.files ?? []).map((f) => f.id)));
  return fileTemplatedBug(projectId, "", {
    templateId: SAVED_ID,
    summary: defect.title,
    platform: "",
    area: "",
    build: "",
    severity: defect.severity,
    stepIndex: null,
    answers,
    attachmentIds: files.map((f) => f.id).filter((id) => !underHeadings.has(id)).slice(0, 20),
    fromDefectId: defect.id,
    foundIn: defect.foundIn || null,
  });
}
