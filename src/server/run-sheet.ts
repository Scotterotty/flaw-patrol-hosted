"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { SHEETS_ENABLED } from "@/lib/features";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";
import { pushRunToSheet, sheetScript, validSheetHook } from "./sheet-sync";

function requireSheets() {
  if (!SHEETS_ENABLED) throw new UserError("Sending results to a spreadsheet is switched off.");
}

/** The script to paste into a sheet, with this project's key in it. */
export async function getSheetScript(projectId: string) {
  return attempt(async () => {
    requireSheets();
    const { project } = await requireProjectAction(projectId, "run:create");
    let secret = (await db.project.findUnique({ where: { id: project.id }, select: { sheetSecret: true } }))?.sheetSecret;
    if (!secret) {
      secret = randomBytes(24).toString("base64url");
      await db.project.update({ where: { id: project.id }, data: { sheetSecret: secret } });
    }
    return { script: sheetScript(secret) };
  });
}

const linkSchema = z.object({
  hook: z.string().trim().min(1, "Paste the Web app URL from Apps Script."),
  tab: z.string().trim().min(1, "Name the tab to write to.").max(100),
  auto: z.boolean().default(false),
});

/** Link a run to a sheet and send it straight away, so a wrong setup shows at once. */
export async function linkRunSheet(projectId: string, runId: string, input: z.input<typeof linkSchema>) {
  return attempt(async () => {
    requireSheets();
    const { project } = await requireProjectAction(projectId, "run:create");
    const data = linkSchema.parse(input);
    if (!validSheetHook(data.hook)) throw new UserError("That isn't a Web app URL. It starts with https://script.google.com/macros/s/ and ends with /exec.");
    const { count } = await db.testRun.updateMany({ where: { id: runId, projectId }, data: { sheetHook: data.hook, sheetTab: data.tab, sheetAuto: data.auto, sheetError: "", sheetLink: "" } });
    if (!count) throw new UserError("This run no longer exists.");
    const error = await pushRunToSheet(runId);
    revalidatePath(`/p/${project.key}`, "layout");
    if (error) throw new UserError(error);
    return {};
  });
}

export async function syncRunSheet(projectId: string, runId: string) {
  return attempt(async () => {
    requireSheets();
    const { project } = await requireProjectAction(projectId, "run:execute");
    const run = await db.testRun.findFirst({ where: { id: runId, projectId }, select: { id: true } });
    if (!run) throw new UserError("This run no longer exists.");
    const error = await pushRunToSheet(run.id);
    revalidatePath(`/p/${project.key}`, "layout");
    if (error) throw new UserError(error);
    return {};
  });
}

/** Whether every saved result goes to the sheet, or only when someone presses Send. */
export async function setRunSheetAuto(projectId: string, runId: string, auto: boolean) {
  return attempt(async () => {
    requireSheets();
    const { project } = await requireProjectAction(projectId, "run:create");
    await db.testRun.updateMany({ where: { id: runId, projectId }, data: { sheetAuto: auto } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

/** Stop sending results. The sheet keeps what it has. */
export async function unlinkRunSheet(projectId: string, runId: string) {
  return attempt(async () => {
    requireSheets();
    const { project } = await requireProjectAction(projectId, "run:create");
    await db.testRun.updateMany({ where: { id: runId, projectId }, data: { sheetHook: null, sheetAuto: false, sheetError: "", sheetSyncedAt: null, sheetLink: "" } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
