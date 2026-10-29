import "server-only";

import type { ResultStatus } from "@prisma/client";
import { after } from "next/server";
import { db } from "@/lib/db";
import { SHEETS_ENABLED } from "@/lib/features";
import { caseKey, PRIORITY_LABEL } from "@/lib/format";
import { parseDraft } from "@/lib/run-draft";
import { STATUS_CHIPS, TESTER_CHIP } from "@/lib/sheet-colors";
import { STATUS_LABEL } from "@/lib/status";
import type { ExpandedStep } from "@/lib/steps";

// Mirrors a run into a tab of a Google Sheet, one row per step, laid out like
// the team's own cycle sheets. The sheet holds a small script (see
// sheetScript) that we post the whole tab to; the tab is rewritten each time,
// so a missed push fixes itself on the next one.

export const SHEET_HEADER = ["Key", "Name", "Description", "Precondition", "Step Order", "Step Description", "Expected Result", "", "Executed By", "Status", "Defects", "Priority", "Folder"];
const CASE_STATUS_COL = 8; // H: the case's status, under a header showing how much of the run is done
const EXECUTED_BY_COL = 9;
const STEP_STATUS_COL = 10;

// The look of the team's R22 cycle sheet, taken from its .xlsx: a dark blue
// header in Montserrat, Calibri body text, rows striped white then gray down
// the whole tab, the case status and tester merged down each case, a thick
// line under each case, and Description and Precondition hidden.
export const SHEET_LOOK = {
  header: "#1C4587",
  headerText: "#F3F3F3",
  headerFont: "Montserrat",
  headerSize: 13,
  font: "Calibri",
  statusFont: "Montserrat",
  size: 11,
  band: "#EBEFF1",
  text: "#000000",
  // Excel character widths, as in the sheet.
  widths: [8.6, 22.8, 19.5, 20.6, 11, 40.9, 37.4, 16.9, 19.8, 14.5, 17.1, 17.1, 21.4],
  hidden: [3, 4],
  frozenColumns: 6,
  centered: [CASE_STATUS_COL, EXECUTED_BY_COL, STEP_STATUS_COL],
  // Only the long-text columns wrap.
  wrapped: [1, 2, 3, 4, 6, 7, 11, 13],
};
/** The sheet's own words for each status ("In Progress", "Not Run"). */
export const SHEET_STATUS: Record<ResultStatus, string> = { ...STATUS_LABEL, IN_PROGRESS: "In Progress", SKIPPED: "Not Run" };
/** The case status dropdown, in the sheet's order. */
export const SHEET_CASE_STATUSES = ["Untested", "In Progress", "Passed", "Failed", "Blocked", "Not Run"];
// Statuses that count as run in the header's percentage, the same rule as the app (Skipped is "Not Run" here).
// "Defective" stays so older sheets that still use it keep their percentage (ver_94 dropped it from the app).
const DONE_STATUSES = ["Passed", "Defective", "Failed", "Blocked", "Not Run"];
/** The live percentage over the case status column: cases with a result ÷ all cases. */
export const doneFormula = (lastRow: number) =>
  `SUMPRODUCT(COUNTIF(H2:H${lastRow},{${DONE_STATUSES.map((s) => `"${s}"`).join(",")}}))/MAX(1,COUNTIF(H2:H${lastRow},"<>"))`;
/** Background and text color for each body cell, row by row. Statuses get theirs from STATUS_CHIPS rules. */
export function sheetColors(rows: string[][]) {
  // Sheet rows 2, 4, 6… are white and 3, 5, 7… gray, carrying on across cases.
  const backgrounds = rows.map((row, i) => row.map(() => (i % 2 === 0 ? "#FFFFFF" : SHEET_LOOK.band)));
  const fontColors = rows.map((row) => row.map(() => SHEET_LOOK.text));
  return { backgrounds, fontColors };
}

/** Where a sheet's script lives. Anything else is refused, so the app never posts elsewhere. */
export function validSheetHook(url: string): boolean {
  if (/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return true;
  // Tests post to a local stand-in.
  return process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url);
}

// A cell starting with these would be read as a formula.
const cell = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v);

export async function buildRunSheet(runId: string) {
  const run = await db.testRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      project: { select: { key: true } },
      entries: {
        orderBy: { position: "asc" },
        include: {
          testCase: { select: { number: true, sourceKey: true, project: { select: { key: true } } } },
          results: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { stepResults: true, testerName: true, defects: { select: { stepIndex: true, defect: { select: { number: true, externalKey: true } } } } },
          },
        },
      },
    },
  });

  const rows: string[][] = [];
  const merges: [number, number, number][] = [];
  const caseEnds: number[] = [];
  let done = 0;
  for (const e of run.entries) {
    const steps = (Array.isArray(e.steps) ? e.steps : []) as unknown as ExpandedStep[];
    const last = e.results[0];
    const draft = e.status === "IN_PROGRESS" ? parseDraft(e.draft) : null;
    const stepStatus = (i: number): ResultStatus => {
      const from = draft ? draft.stepResults : ((last?.stepResults ?? []) as { status: ResultStatus }[]);
      return from[i]?.status ?? "UNTESTED";
    };
    const bugs = new Map<number | null, string[]>();
    const addBug = (at: number | null, d: { number: number; externalKey: string | null }) => {
      const key = d.externalKey ?? `D-${d.number}`;
      const list = bugs.get(at) ?? [];
      if (!list.includes(key)) list.push(key);
      bugs.set(at, list);
    };
    for (const l of draft ? draft.defects : (last?.defects ?? [])) addBug(l.stepIndex, l.defect);
    if (DONE_STATUSES.includes(SHEET_STATUS[e.status])) done++;

    const by = (draft ? e.draftByName : last?.testerName) || "—";
    const first = rows.length + 2; // sheet row of this case's first step, after the header
    const count = Math.max(steps.length, 1);
    for (let i = 0; i < count; i++) {
      const s = steps[i];
      const atStep = s ? (bugs.get(i) ?? []) : [];
      const caseBugs = i === 0 ? (bugs.get(null) ?? []) : [];
      rows.push(
        [
          i === 0 ? (e.testCase.sourceKey ?? caseKey(e.testCase.project.key, e.testCase.number)) : "",
          i === 0 ? e.title : "",
          "",
          i === 0 ? e.preconditions : "",
          s?.number ?? "",
          s?.action ?? "",
          s?.expected ?? "",
          i === 0 ? SHEET_STATUS[e.status] : "",
          i === 0 ? by : "",
          s ? SHEET_STATUS[stepStatus(i)] : "",
          [...caseBugs, ...atStep].join(", "),
          i === 0 ? PRIORITY_LABEL[e.priority] : "",
          i === 0 ? e.folderPath : "",
        ],
      );
    }
    if (count > 1) merges.push([first, CASE_STATUS_COL, count], [first, EXECUTED_BY_COL, count]);
    caseEnds.push(first + count - 1);
  }
  const header = [...SHEET_HEADER];
  const total = run.entries.length;
  header[CASE_STATUS_COL - 1] = `${total ? ((done / total) * 100).toFixed(2) : "0.00"}%`;
  // Rows where a case starts, for the case status and tester dropdowns.
  const caseStarts = caseEnds.map((_, i) => (i === 0 ? 2 : caseEnds[i - 1] + 1));
  const members = await db.projectMember.findMany({ where: { projectId: run.projectId }, select: { user: { select: { name: true, email: true } } } });
  const names = [...new Set([...members.map((m) => m.user.name || m.user.email), ...rows.map((r) => r[EXECUTED_BY_COL - 1]).filter((n) => n && n !== "—")])].sort((a, b) => a.localeCompare(b));
  return { name: run.name, header, rows, merges, caseEnds, caseStarts, testers: ["—", ...names] };
}

/** Send the run to its sheet now. Returns an error to show, or null. */
export async function pushRunToSheet(runId: string): Promise<string | null> {
  const run = await db.testRun.findUnique({ where: { id: runId }, select: { sheetHook: true, sheetTab: true, project: { select: { sheetSecret: true } } } });
  if (!SHEETS_ENABLED || !run?.sheetHook || !run.project.sheetSecret) return null;
  let error: string | null = null;
  let link: string | undefined;
  try {
    if (!validSheetHook(run.sheetHook)) throw new Error("That isn't a Google Sheets script address.");
    const { header, rows, merges, caseEnds, caseStarts, testers } = await buildRunSheet(runId);
    const res = await fetch(run.sheetHook, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        secret: run.project.sheetSecret,
        tab: run.sheetTab || "Flaw Patrol",
        rows: [header, ...rows].map((r) => r.map(cell)),
        merges,
        caseEnds,
        caseStarts,
        lists: { status: SHEET_CASE_STATUSES, testers },
        chips: STATUS_CHIPS,
        testerChip: TESTER_CHIP,
        formula: doneFormula(rows.length + 1),
        look: { ...SHEET_LOOK, ...sheetColors(rows) },
      }),
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let reply: { ok?: boolean; error?: string; url?: string } = {};
    try {
      reply = JSON.parse(text);
    } catch {
      // Google answers with a sign-in page when the web app isn't open to "Anyone".
      throw new Error(
        res.ok ? "The sheet's script didn't answer. In Apps Script, check the deployment's \"Who has access\" is set to Anyone." : `Google answered ${res.status}.`,
      );
    }
    if (!reply.ok) throw new Error(reply.error ?? "The sheet's script refused the update.");
    link = reply.url;
  } catch (e) {
    error = e instanceof Error ? (e.name === "TimeoutError" ? "Google took too long to answer." : e.message) : "Couldn't reach the sheet.";
  }
  await db.testRun.update({
    where: { id: runId },
    data: error ? { sheetError: error } : { sheetError: "", sheetSyncedAt: new Date(), ...(link ? { sheetLink: link } : {}) },
  });
  return error;
}

// One push at a time per run; changes made during a push trigger one more.
const pushing = new Map<string, boolean>();

async function pushSoon(runId: string) {
  if (pushing.has(runId)) {
    pushing.set(runId, true);
    return;
  }
  try {
    do {
      pushing.set(runId, false);
      await pushRunToSheet(runId);
    } while (pushing.get(runId));
  } finally {
    pushing.delete(runId);
  }
}

/** After the response is sent, bring the run's sheet up to date, if it's set to follow along. */
export function queueSheetSync(run: { id: string; sheetHook: string | null; sheetAuto: boolean }) {
  if (SHEETS_ENABLED && run.sheetHook && run.sheetAuto) after(() => pushSoon(run.id));
}

/** The script someone pastes into their sheet (Extensions > Apps Script). */
export function sheetScript(secret: string) {
  return `// Flaw Patrol: keeps a tab of this sheet up to date with a test run.
// Paste this in Extensions > Apps Script, then Deploy > New deployment > Web app
// (Execute as: Me, Who has access: Anyone) and copy the Web app URL into Flaw Patrol.
const KEY = "${secret}";

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== KEY) return reply({ ok: false, error: "This sheet's script has a different key. Copy the script from Flaw Patrol again." });
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = book.getSheetByName(body.tab);
    const isNew = !sheet;
    if (isNew) sheet = book.insertSheet(body.tab);
    const look = body.look;
    const n = body.rows.length;
    const width = body.rows[0].length;
    if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    if (sheet.getMaxRows() < n) sheet.insertRowsAfter(sheet.getMaxRows(), n - sheet.getMaxRows());
    const max = sheet.getMaxRows();
    const all = sheet.getRange(1, 1, max, width);
    all.breakApart();
    all.clearContent();
    all.clearDataValidations();
    all.setBorder(false, false, false, false, false, false);
    if (max > n) sheet.getRange(n + 1, 1, max - n, width).setBackground(null);

    sheet.getRange(1, 1, n, width).setNumberFormat("@").setValues(body.rows);
    sheet.getRange(1, 1, 1, width).setBackground(look.header).setFontColor(look.headerText).setFontFamily(look.headerFont)
      .setFontSize(look.headerSize).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
    // The header over the case statuses is a live percentage, as in the cycle sheets.
    sheet.getRange(1, 8).setNumberFormat("0.00%").setFormula("=" + body.formula);
    if (n > 1) {
      const rest = sheet.getRange(2, 1, n - 1, width);
      rest.setBackgrounds(look.backgrounds).setFontColors(look.fontColors).setFontFamily(look.font).setFontWeight("normal")
        .setFontSize(look.size).setVerticalAlignment("middle").setHorizontalAlignment("left").setWrap(false);
      look.wrapped.forEach(function (c) { sheet.getRange(2, c, n - 1, 1).setWrap(true); });
      look.centered.forEach(function (c) { sheet.getRange(2, c, n - 1, 1).setHorizontalAlignment("center").setFontFamily(look.statusFont); });
    }
    body.merges.forEach(function (m) { sheet.getRange(m[0], m[1], m[2], 1).merge(); });
    // Status colors follow the word, so they stay right when someone edits the sheet.
    if (n > 1) {
      const statusCols = [sheet.getRange(2, 8, n - 1, 1), sheet.getRange(2, 10, n - 1, 1)];
      const ours = body.chips.map(function (c) {
        return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(c.status).setBackground(c.fill).setFontColor(c.text).setRanges(statusCols).build();
      });
      // Anyone named in Executed By, but not "—" for nobody.
      ours.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(I2<>"",I2<>"—")')
        .setBackground(body.testerChip.fill).setFontColor(body.testerChip.text).setRanges([sheet.getRange(2, 9, n - 1, 1)]).build());
      const others = sheet.getConditionalFormatRules().filter(function (r) {
        return !r.getRanges().some(function (g) { return g.getColumn() >= 8 && g.getColumn() <= 10; });
      });
      sheet.setConditionalFormatRules(others.concat(ours));
    }
    // Dropdowns on each case's status and tester, like the cycle sheets.
    if (body.caseStarts.length) {
      const pick = function (list) { return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build(); };
      sheet.getRangeList(body.caseStarts.map(function (r) { return "H" + r; })).getRanges().forEach(function (r) { r.setDataValidation(pick(body.lists.status)); });
      sheet.getRangeList(body.caseStarts.map(function (r) { return "I" + r; })).getRanges().forEach(function (r) { r.setDataValidation(pick(body.lists.testers)); });
    }
    // A line under each case, wherever the cases now fall.
    const last = String.fromCharCode(64 + width);
    if (body.caseEnds.length) {
      sheet.getRangeList(body.caseEnds.map(function (r) { return "A" + r + ":" + last + r; }))
        .setBorder(null, null, true, null, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }
    // Filter buttons on the header, covering every row now in the tab.
    if (sheet.getFilter()) sheet.getFilter().remove();
    sheet.getRange(1, 1, n, width).createFilter();
    if (isNew) {
      sheet.setFrozenRows(1);
      sheet.setFrozenColumns(look.frozenColumns);
      look.widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, Math.round(w * 7 + 5)); });
      look.hidden.forEach(function (c) { sheet.hideColumns(c); });
    }
    return reply({ ok: true, url: book.getUrl() + "#gid=" + sheet.getSheetId() });
  } finally {
    lock.releaseLock();
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
