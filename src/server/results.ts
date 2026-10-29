"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { sessionLogSchema } from "@/lib/charter";
import { draftSchema, parseDraft, type Draft, type DraftInput } from "@/lib/run-draft";
import { requireProjectAction } from "@/lib/session";
import { DEFAULT_SEVERITY, severitySchema } from "@/lib/severity";
import { OPEN } from "@/lib/status";
import { alertsForResult } from "@/lib/slack";
import { attempt, UserError } from "./result";
import { queueSheetSync } from "./sheet-sync";
import { questMoments } from "@/lib/quest-data";
import { parseGear } from "@/lib/quest-gear";

const statusEnum = z.enum(["UNTESTED", "PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED"]);

const resultSchema = z.object({
  status: statusEnum.exclude(["UNTESTED"]),
  stepResults: z.array(z.object({ status: statusEnum, actual: z.string().max(10000).default("") })).max(1000),
  comment: z.string().max(10000).default(""),
  elapsedSec: z.number().int().min(0).max(86400 * 7).nullable().default(null),
  attachmentIds: z.array(z.string()).max(200).default([]),
  sessionLog: sessionLogSchema.nullable().default(null),
  defects: z
    .array(
      z.union([
        z.object({ existingId: z.string(), stepIndex: z.number().int().min(0).nullable() }),
        z.object({
          title: z.string().trim().min(1, "Defect title is required").max(300),
          description: z.string().max(10000).default(""),
          severity: severitySchema.default(DEFAULT_SEVERITY),
          externalKey: z.string().trim().max(100).nullable().default(null),
          externalUrl: z.string().trim().url().max(1000).nullable().or(z.literal("")).default(null),
          stepIndex: z.number().int().min(0).nullable(),
        }),
      ]),
    )
    .max(50)
    .default([]),
});
export type ResultInput = z.input<typeof resultSchema>;

/** Record an outcome for a case in a run. Each call adds to the case's history. */
export async function submitResult(projectId: string, entryId: string, input: ResultInput) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:execute");
    const data = resultSchema.parse(input);
    const entry = await db.runEntry.findFirst({ where: { id: entryId, run: { projectId } }, include: { run: true } });
    if (!entry) throw new UserError("This case is no longer in the run.");
    if (entry.run.state === "COMPLETED") throw new UserError("This run is closed. Reopen it to record results.");
    const stepCount = Array.isArray(entry.steps) ? entry.steps.length : 0;
    if (data.stepResults.length !== stepCount) throw new UserError("The steps changed. Reload the page.");

    const sharedFiles = parseDraft(entry.draft)?.attachments.map((a) => a.id) ?? [];
    const quests = user.gameEnabled && user.questMap;
    const worn = parseGear(user.questGear);
    const gear = quests && Object.keys(worn).length ? worn : null;
    const result = await db.$transaction(async (tx) => {
      const result = await tx.testResult.create({
        data: {
          entryId,
          runId: entry.runId,
          caseId: entry.caseId,
          caseVersion: entry.caseVersion,
          status: data.status,
          stepResults: data.stepResults as Prisma.InputJsonValue,
          comment: data.comment,
          elapsedSec: data.elapsedSec,
          sessionLog: entry.kind === "EXPLORATORY" && data.sessionLog ? (data.sessionLog as Prisma.InputJsonValue) : Prisma.DbNull,
          testerId: user.id,
          testerName: user.name ?? user.email,
          // Quest players: what they wore, so encounter lines keep naming it.
          questGear: gear ? gear : Prisma.DbNull,
        },
      });
      await tx.runEntry.update({
        where: { id: entryId },
        // Testing an unclaimed case claims it, so it counts as yours on the run page.
        data: { status: data.status, lastTestedAt: new Date(), draft: Prisma.DbNull, draftAt: null, draftByName: "", draftById: null, ...(entry.assigneeId ? {} : { assigneeId: user.id }) },
      });
      if (data.attachmentIds.length) {
        await tx.attachment.updateMany({
          // Yours, or a teammate's file on this case's autosaved results (two people can work on one case).
          where: {
            id: { in: data.attachmentIds },
            projectId,
            OR: [
              { resultId: null, OR: [{ uploadedById: user.id }, { id: { in: sharedFiles } }] },
              // Saving a finished case again keeps the files its last result had.
              { result: { entryId: entry.id } },
            ],
          },
          data: { resultId: result.id },
        });
      }
      for (const d of data.defects) {
        let defectId: string;
        if ("existingId" in d) {
          const found = await tx.defect.findFirst({ where: { id: d.existingId, projectId } });
          if (!found) throw new UserError("A linked defect no longer exists.");
          defectId = found.id;
        } else {
          const { defectSeq } = await tx.project.update({ where: { id: projectId }, data: { defectSeq: { increment: 1 } } });
          defectId = (
            await tx.defect.create({
              data: {
                projectId,
                number: defectSeq,
                title: d.title,
                description: d.description,
                severity: d.severity,
                externalKey: d.externalKey || null,
                externalUrl: d.externalUrl || null,
                createdById: user.id,
                createdBy: user.name ?? user.email,
              },
            })
          ).id;
        }
        await tx.defectLink.create({ data: { defectId, resultId: result.id, stepIndex: d.stepIndex } });
      }
      return result;
    });

    revalidatePath(`/p/${project.key}`, "layout");
    queueSheetSync(entry.run);
    // Every case now has a result: the runner offers to close the run.
    const runDone = entry.run.state === "ACTIVE" && (await db.runEntry.count({ where: { runId: entry.runId, status: { in: OPEN } } })) === 0;
    await alertsForResult({ cycle: project, resultId: result.id, status: data.status, comment: data.comment, tester: user.name ?? user.email, entryId, wasOpen: OPEN.includes(entry.status), runDone }).catch((e) => console.warn("Slack alerts failed", e));
    return { resultId: result.id, runId: entry.runId, runDone, quest: quests ? await questMoments(entry.runId, entryId, result.createdAt) : [] };
  });
}

/**
 * Save step results as they're picked, so leaving a case half done loses
 * nothing. The case shows In progress until its result is saved; clearing
 * everything puts it back to what it was.
 */
// Which parts of a draft the tester changed since they last heard from the
// server. Only those are written, so two people on one case don't wipe each
// other's step results. Left out, the whole draft is replaced.
const touchedSchema = z
  .object({
    steps: z.array(z.number().int().min(0)).max(1000),
    override: z.boolean(),
    comment: z.boolean(),
    attachments: z.boolean(),
    defects: z.boolean(),
  })
  .optional();
export type DraftTouched = z.input<typeof touchedSchema>;

export async function saveDraft(projectId: string, entryId: string, input: DraftInput, touchedInput?: DraftTouched) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:execute");
    const sent = draftSchema.parse(input);
    const touched = touchedSchema.parse(touchedInput);
    const out = await db.$transaction(async (tx) => {
      // One save at a time per case, so merges never read a stale draft.
      await tx.$queryRaw`SELECT id FROM "RunEntry" WHERE id = ${entryId} FOR UPDATE`;
      const entry = await tx.runEntry.findFirst({
        where: { id: entryId, run: { projectId } },
        include: { run: true, results: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } } },
      });
      if (!entry) throw new UserError("This case is no longer in the run.");
      if (entry.run.state === "COMPLETED") throw new UserError("This run is closed. Reopen it to record results.");
      const stepCount = Array.isArray(entry.steps) ? entry.steps.length : 0;
      if (sent.stepResults.length !== stepCount) throw new UserError("The steps changed. Reload the page.");

      const old = parseDraft(entry.draft);
      const draft: Draft =
        touched && old && old.stepResults.length === stepCount
          ? {
              ...sent,
              stepResults: old.stepResults.map((s, i) => (touched.steps.includes(i) ? sent.stepResults[i] : s)),
              override: touched.override ? sent.override : old.override,
              comment: touched.comment ? sent.comment : old.comment,
              attachments: touched.attachments ? sent.attachments : old.attachments,
              defects: touched.defects ? sent.defects : old.defects,
              elapsedSec: Math.max(sent.elapsedSec, old.elapsedSec),
            }
          : sent;

      const empty =
        draft.stepResults.every((s) => s.status === "UNTESTED" && !s.actual.trim()) &&
        !draft.override &&
        !draft.comment.trim() &&
        !draft.attachments.length &&
        !draft.defects.length &&
        !draft.notes.length &&
        // A session that has started its timer is under way even before the first note.
        !(entry.kind === "EXPLORATORY" && draft.elapsedSec > 0);
      const status = empty ? (entry.results[0]?.status ?? "UNTESTED") : "IN_PROGRESS";
      const at = new Date();
      await tx.runEntry.update({
        where: { id: entryId },
        data: empty
          ? { status, draft: Prisma.DbNull, draftAt: null, draftByName: "", draftById: null }
          : {
              status,
              draft: draft as Prisma.InputJsonValue,
              draftAt: at,
              draftByName: user.name ?? user.email,
              draftById: user.id,
              ...(entry.assigneeId ? {} : { assigneeId: user.id }),
            },
      });
      return { entry, status, empty, draft, at };
    });
    const { entry, status, empty } = out;
    if (status !== entry.status || (!empty && !entry.assigneeId)) revalidatePath(`/p/${project.key}`, "layout");
    queueSheetSync(entry.run);
    return { status, draft: empty ? null : out.draft, draftAt: empty ? null : out.at.toISOString() };
  });
}

const MAX_ATTACHMENT = 10 * 1024 * 1024;
// Screen recordings run up to 5 minutes, so videos get more room.
const MAX_VIDEO = 75 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpeg|gif|webp)|text\/plain|application\/(pdf|json|zip|x-zip-compressed)|video\/(mp4|webm))$/;

/** Upload evidence while testing; it is linked to the result when the result is submitted. */
export async function uploadAttachment(projectId: string, form: FormData) {
  return attempt(async () => {
    // Viewers attach screenshots to bug bash bugs (ver_94); a file only joins a result someone can record.
    const { user } = await requireProjectAction(projectId, "bash:join");
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a file.");
    if (!file.size) throw new UserError(`${file.name || "That file"} is empty, so it wasn't attached.`);
    const video = /^video\//.test(file.type);
    if (file.size > (video ? MAX_VIDEO : MAX_ATTACHMENT)) throw new UserError(video ? "Videos can be up to 75 MB." : "Files can be up to 10 MB.");
    // Client logs (.log, DxDiag.txt) often come without a type, or an odd text one.
    const type = /\.(log|txt)$/i.test(file.name) && (!file.type || file.type.startsWith("text/")) ? "text/plain" : file.type || "application/octet-stream";
    if (!ALLOWED.test(type)) throw new UserError("Attach images, PDFs, text logs, JSON, zip or video files.");
    const stepIndex = form.get("stepIndex");
    const a = await db.attachment.create({
      data: {
        projectId,
        fileName: (file.name || "pasted-image.png").slice(0, 200),
        contentType: type,
        size: file.size,
        data: Buffer.from(await file.arrayBuffer()),
        uploadedById: user.id,
        stepIndex: stepIndex === null || stepIndex === "" ? null : Number(stepIndex),
      },
      select: { id: true, fileName: true, contentType: true, size: true, stepIndex: true },
    });
    return { attachment: a };
  });
}
