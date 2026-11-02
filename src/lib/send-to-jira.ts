import "server-only";
import type { Severity } from "@prisma/client";
import type { SendToJiraData } from "@/components/defect-controls";
import { db } from "./db";

/**
 * Send to Jira: for bugs saved before Jira was connected, what the bug box needs
 * to file each one: the result it came from, the step, what happened, and its files.
 * Bugs not linked to any result can't be sent, so they're left out.
 */
export async function sendToJiraData(defects: { id: string; projectId: string; number: number; title: string; severity: Severity; label: string }[]) {
  const out = new Map<string, SendToJiraData>();
  if (!defects.length) return out;
  const links = await db.defectLink.findMany({
    where: { defectId: { in: defects.map((d) => d.id) } },
    select: { defectId: true, stepIndex: true, result: { select: { id: true, entryId: true, comment: true, stepResults: true, createdAt: true, run: { select: { projectId: true } } } } },
  });
  const files = await db.attachment.findMany({
    where: { resultId: { in: links.map((l) => l.result.id) } },
    select: { id: true, fileName: true, contentType: true, resultId: true, stepIndex: true },
    orderBy: { createdAt: "asc" },
  });
  for (const d of defects) {
    // The first result it was found in, in its own test cycle.
    const link = links
      .filter((l) => l.defectId === d.id && l.result.run.projectId === d.projectId)
      .sort((a, b) => a.result.createdAt.getTime() - b.result.createdAt.getTime())[0];
    if (!link) continue;
    const steps = Array.isArray(link.result.stepResults) ? (link.result.stepResults as { actual?: string }[]) : [];
    const actual = link.stepIndex !== null ? (steps[link.stepIndex]?.actual ?? "") : link.result.comment;
    out.set(d.id, {
      projectId: d.projectId,
      defect: { id: d.id, label: d.label, title: d.title, severity: d.severity },
      entryId: link.result.entryId,
      stepIndex: link.stepIndex,
      actual: actual || link.result.comment,
      attachments: files
        .filter((f) => f.resultId === link.result.id && (link.stepIndex === null || f.stepIndex === link.stepIndex || f.stepIndex === null))
        .map((f) => ({ id: f.id, fileName: f.fileName, contentType: f.contentType, label: f.stepIndex === null ? "Whole case" : `Step ${f.stepIndex + 1}` })),
    });
  }
  return out;
}
