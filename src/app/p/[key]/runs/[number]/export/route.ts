import ExcelJS from "exceljs";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SHEETS_ENABLED } from "@/lib/features";
import { projectAccess } from "@/lib/session";
import { STATUS_CHIPS, TESTER_CHIP } from "@/lib/sheet-colors";
import { buildRunSheet, doneFormula, SHEET_CASE_STATUSES, SHEET_LOOK, sheetColors } from "@/server/sheet-sync";

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

/** The run's current results as an .xlsx laid out and styled like the team's cycle sheets: one row per step. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string; number: string }> }) {
  if (!SHEETS_ENABLED) notFound();
  const { key, number } = await params;
  const { project } = await projectAccess(key);
  const run = await db.testRun.findUnique({ where: { projectId_number: { projectId: project.id, number: Number(number) || 0 } }, select: { id: true, number: true } });
  if (!run) notFound();
  const { name, header, rows, merges, caseEnds, caseStarts, testers } = await buildRunSheet(run.id);
  const { backgrounds, fontColors } = sheetColors(rows);

  const book = new ExcelJS.Workbook();
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

  const file = `${project.key}-R${run.number}-${name}`.replace(/[^\w.-]+/g, "_").slice(0, 120);
  return new Response(await book.xlsx.writeBuffer(), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
