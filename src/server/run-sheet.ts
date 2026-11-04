"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { SHEETS_ENABLED } from "@/lib/features";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";
import { colLetter, FILL_ROLES, fillConfigSchema, findLayout, matchEntries, type FillRole } from "@/lib/sheet-fill";
import { fillEntries, pushRunToSheet, readSheet, sheetScript, validSheetHook } from "./sheet-sync";

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
  mode: z.enum(["tab", "fill"]).default("tab"),
  fill: fillConfigSchema.optional(),
});

const NOT_A_HOOK = "That isn't a Web app URL. It starts with https://script.google.com/macros/s/ and ends with /exec.";

/** Another run of this project already writing the same tab (or, when both fill, the same columns). */
async function clash(projectId: string, runId: string, hook: string, tab: string, mode: "tab" | "fill", set: number) {
  const others = await db.testRun.findMany({ where: { projectId, sheetHook: hook, sheetTab: tab, NOT: { id: runId } }, select: { name: true, sheetMode: true, sheetFill: true } });
  return others.find((o) => mode === "tab" || o.sheetMode !== "fill" || ((o.sheetFill as { set?: number } | null)?.set ?? 0) === set) ?? null;
}

/** Link a run to a sheet and send it straight away, so a wrong setup shows at once. */
export async function linkRunSheet(projectId: string, runId: string, input: z.input<typeof linkSchema>) {
  return attempt(async () => {
    requireSheets();
    const { project } = await requireProjectAction(projectId, "run:create");
    const data = linkSchema.parse(input);
    if (!validSheetHook(data.hook)) throw new UserError(NOT_A_HOOK);
    const fill = data.mode === "fill" ? fillConfigSchema.parse(data.fill ?? {}) : null;
    const other = await clash(project.id, runId, data.hook, data.tab, data.mode, fill?.set ?? 0);
    if (other)
      throw new UserError(
        fill && other.sheetMode === "fill"
          ? `${other.name} already fills these columns of the ${data.tab} tab. Pick other columns or another tab, or stop sending from that run first.`
          : `${other.name} already sends to the ${data.tab} tab of this sheet. Pick another tab, or stop sending from that run first.`,
      );
    const { count } = await db.testRun.updateMany({
      where: { id: runId, projectId },
      data: { sheetHook: data.hook, sheetTab: data.tab, sheetAuto: data.auto, sheetMode: data.mode, sheetFill: fill ?? undefined, sheetError: "", sheetNote: "", sheetLink: "" },
    });
    if (!count) throw new UserError("This run no longer exists.");
    const error = await pushRunToSheet(runId);
    revalidatePath(`/p/${project.key}`, "layout");
    if (error) throw new UserError(error);
    return {};
  });
}

export type FillPreview = {
  headerRow: number;
  sets: { label: string; cols: { role: FillRole; letter: string; header: string }[] }[];
  total: number;
  matched: number;
  unmatched: { id: string; title: string }[];
  free: { row: number; text: string }[];
};

const previewSchema = z.object({ hook: z.string().trim(), tab: z.string().trim().min(1, "Name the tab to fill.").max(100), headerRow: z.number().int().min(1).max(500).nullable().default(null) });

/** Reads the sheet and says what "Fill in my columns" would do: the header row, the columns it can fill, and the cases it can't place. */
export async function previewRunSheet(projectId: string, runId: string, input: z.input<typeof previewSchema>) {
  return attempt(async (): Promise<FillPreview> => {
    requireSheets();
    const { project } = await requireProjectAction(projectId, "run:create");
    const data = previewSchema.parse(input);
    if (!validSheetHook(data.hook)) throw new UserError(NOT_A_HOOK);
    const run = await db.testRun.findFirst({ where: { id: runId, projectId: project.id }, select: { id: true } });
    if (!run) throw new UserError("This run no longer exists.");
    const secret = (await db.project.findUnique({ where: { id: project.id }, select: { sheetSecret: true } }))?.sheetSecret;
    if (!secret) throw new UserError("Copy the script into the sheet first.");
    let grid;
    try {
      grid = await readSheet(data.hook, secret, data.tab);
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : "Couldn't reach the sheet.");
    }
    const layout = findLayout(grid, data.headerRow);
    if (!layout)
      throw new UserError(
        data.headerRow
          ? `Row ${data.headerRow} doesn't look like a header. It needs a test name or key column and a column like Result, Status or Bug Ticket.`
          : `Couldn't find a header row in the first 50 rows of the ${data.tab} tab. It needs a test name or key column and a column like Result, Status or Bug Ticket.`,
      );
    const entries = await fillEntries(run.id);
    const match = matchEntries(grid, layout, entries);
    const header = (c: number) => (grid.values[layout.headerRow - 1]?.[c - 1] ?? "").trim();
    return {
      headerRow: layout.headerRow,
      sets: layout.sets.map((s) => ({
        label: s.label,
        cols: FILL_ROLES.filter((r) => s.cols[r]).map((r) => ({ role: r, letter: colLetter(s.cols[r]!), header: header(s.cols[r]!) })),
      })),
      total: entries.length,
      matched: match.rows.size,
      unmatched: match.unmatched.slice(0, 50).map((id) => ({ id, title: entries.find((e) => e.id === id)!.title })),
      free: match.free.slice(0, 500),
    };
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
    await db.testRun.updateMany({ where: { id: runId, projectId }, data: { sheetHook: null, sheetAuto: false, sheetError: "", sheetNote: "", sheetSyncedAt: null, sheetLink: "" } });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
