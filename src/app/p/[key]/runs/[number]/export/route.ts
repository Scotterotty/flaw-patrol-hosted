import ExcelJS from "exceljs";
import { versionText } from "@/lib/run-label";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SHEETS_ENABLED } from "@/lib/features";
import { projectAccess } from "@/lib/session";
import { chipFor, STATUS_CHIPS, TESTER_CHIP } from "@/lib/sheet-colors";
import { caseKey } from "@/lib/format";
import { entryClientResults } from "@/lib/clients";
import { clientGridEntry } from "@/lib/client-grid-data";
import type { ResultStatus } from "@prisma/client";
import { buildRunSheet, doneFormula, SHEET_CASE_STATUSES, SHEET_LOOK, sheetColors } from "@/server/sheet-sync";

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

/** The run's current results as an .xlsx laid out and styled like the team's cycle sheets: one row per step. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string; number: string }> }) {
  if (!SHEETS_ENABLED) notFound();
  const { key, number } = await params;
  const { project } = await projectAccess(key);
  const run = await db.testRun.findUnique({ where: { projectId_number: { projectId: project.id, number: Number(number) || 0 } }, select: { id: true, number: true, build: true, clients: true } });
  if (!run) notFound();
  const { name, header, rows, merges, caseEnds, caseStarts, testers } = await buildRunSheet(run.id);
  const { backgrounds, fontColors } = sheetColors(rows);

  const book = new ExcelJS.Workbook();
  // Clients (ver_214): a run with clients gets a "By client" sheet first, one column per client.
  if (run.clients.length) await addClientSheet(book, run.id, run.clients);
  const sheet = book.addWorksheet(name.replace(/[*?:\\/[\]]/g, " ").slice(0, 31) || "Results", {
    // The header row and columns A to F stay put while scrolling, as in the cycle sheets.
    views: [{ state: "frozen", xSplit: SHEET_LOOK.frozenColumns, ySplit: 1 }],
    // Prints like the cycle sheet's PDF: landscape, one page wide, header on every page.
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1", horizontalCentered: true },
  });
  sheet.columns = SHEET_LOOK.widths.map((width, i) => ({ width, hidden: SHEET_LOOK.hidden.includes(i + 1) }));
  // Step numbers like 1.1 are numbers in the cycle sheets.
  sheet.addRows([header, ...rows.map((r) => r.map((v, j) => (j === 4 && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v)))]);
  const head = sheet.getRow(1);
  head.eachCell({ includeEmpty: true }, (c, col) => {
    c.font = { name: SHEET_LOOK.headerFont, bold: true, size: SHEET_LOOK.headerSize, color: { argb: argb(SHEET_LOOK.headerText) } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(SHEET_LOOK.header) } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: SHEET_LOOK.wrapped.includes(col) };
  });
  // The percentage over the case statuses is a live formula, so it follows edits made in the file.
  const pct = head.getCell(8);
  pct.value = { formula: doneFormula(rows.length + 1), result: parseFloat(header[7]) / 100 };
  pct.numFmt = "0.00%";
  rows.forEach((values, i) => {
    const row = sheet.getRow(i + 2);
    values.forEach((_, j) => {
      const c = row.getCell(j + 1);
      const status = SHEET_LOOK.centered.includes(j + 1);
      c.font = { name: status ? SHEET_LOOK.statusFont : SHEET_LOOK.font, size: SHEET_LOOK.size, color: { argb: argb(fontColors[i][j]) } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(backgrounds[i][j]) } };
      c.alignment = { vertical: "middle", horizontal: status ? "center" : "left", wrapText: SHEET_LOOK.wrapped.includes(j + 1) };
    });
  });
  for (const [r, c, n] of merges) sheet.mergeCells(r, c, r + n - 1, c);
  for (const r of caseEnds) for (let c = 1; c <= header.length; c++) sheet.getRow(r).getCell(c).border = { bottom: { style: "medium", color: { argb: "FF000000" } } };
  // Status colors as rules, which Google keeps on import, so they follow the word when someone edits it.
  if (rows.length) {
    sheet.addConditionalFormatting({
      ref: `H2:H${rows.length + 1} J2:J${rows.length + 1}`,
      rules: STATUS_CHIPS.map((c, i) => ({
        type: "cellIs" as const,
        operator: "equal" as const,
        priority: i + 1,
        formulae: [`"${c.status}"`],
        style: { fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: argb(c.fill) } }, font: { color: { argb: argb(c.text) } } },
      })),
    });
    // Anyone named in Executed By, but not "—" for nobody.
    const last = rows.length + 1;
    sheet.addConditionalFormatting({
      ref: `I2:I${last}`,
      rules: [
        {
          type: "expression" as const,
          priority: STATUS_CHIPS.length + 1,
          formulae: ['AND(I2<>"",I2<>"—")'],
          style: { fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: argb(TESTER_CHIP.fill) } }, font: { color: { argb: argb(TESTER_CHIP.text) } } },
        },
      ],
    });
    // Filter buttons on the header, as in the cycle sheets.
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: header.length } };
  }
  // Dropdowns on each case's status and tester, like the cycle sheets. Excel caps a list at 255 characters.
  const list = (items: string[]) => `"${items.map((v) => v.replace(/[",]/g, " ")).join(",")}"`;
  const pick = (items: string[]) => ({ type: "list" as const, allowBlank: true, showErrorMessage: false, formulae: [list(items)] });
  const testerList = list(testers).length <= 255 ? testers : null;
  for (const r of caseStarts) {
    sheet.getCell(r, 8).dataValidation = pick(SHEET_CASE_STATUSES);
    if (testerList) sheet.getCell(r, 9).dataValidation = pick(testerList);
  }

  const file = [project.key, name, versionText(run.build)].filter(Boolean).join("-").replace(/[^\w.-]+/g, "_").slice(0, 120);
  return new Response(await book.xlsx.writeBuffer(), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

const CLIENT_WORD: Record<ResultStatus, string> = {
  UNTESTED: "Not Run",
  IN_PROGRESS: "In Progress",
  PASSED: "Passed",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  RETEST: "Retest",
  SKIPPED: "Skipped",
  EXPLORED: "Explored",
};

/** Case, title, one column per client ("Doesn't apply" when it isn't tested there), the case result and its bugs. */
async function addClientSheet(book: ExcelJS.Workbook, runId: string, clients: string[]) {
  const [entries, links] = await Promise.all([
    db.runEntry.findMany({
      where: { runId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        title: true,
        folderPath: true,
        status: true,
        steps: true,
        testData: true,
        clients: true,
        draft: true,
        results: { orderBy: { createdAt: "desc" }, take: 1, select: { stepResults: true } },
        testCase: { select: { number: true, project: { select: { key: true } } } },
      },
    }),
    db.defectLink.findMany({ where: { result: { runId } }, include: { defect: true, result: { select: { entryId: true } } } }),
  ]);
  const sheet = book.addWorksheet("By client", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  sheet.columns = [{ width: 12 }, { width: 48 }, { width: 28 }, ...clients.map(() => ({ width: 16 })), { width: 14 }, { width: 24 }];
  sheet.addRow(["Case", "Title", "Folder", ...clients, "Case result", "Bugs"]);
  for (const e of entries) {
    const g = clientGridEntry(e, caseKey(e.testCase.project.key, e.testCase.number), links);
    const cells = entryClientResults(g, g.progress);
    const bugs = [...new Set(Object.values(g.bugs).flat().map((b) => b.key))].join(", ");
    sheet.addRow([g.caseKey, e.title, e.folderPath, ...clients.map((c) => (e.clients.includes(c) ? CLIENT_WORD[cells[c] ?? "UNTESTED"] : "Doesn't apply")), CLIENT_WORD[e.status], bugs]);
  }
  sheet.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: argb(SHEET_LOOK.headerText) } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(SHEET_LOOK.header) } };
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
  const first = 4;
  const last = first + clients.length;
  sheet.eachRow((row, r) => {
    if (r === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    for (let col = first; col <= last; col++) {
      const c = row.getCell(col);
      const word = String(c.value ?? "");
      c.alignment = { vertical: "top", horizontal: "center" };
      if (word === "Doesn't apply") c.font = { color: { argb: "FF9AA0A6" }, italic: true };
      else {
        const chip = chipFor(word);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(chip.fill) } };
        c.font = { color: { argb: argb(chip.text) } };
      }
    }
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: entries.length + 1, column: last + 1 } };
}
