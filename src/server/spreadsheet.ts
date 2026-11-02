"use server";

import ExcelJS from "exceljs";
import { requireProjectAction } from "@/lib/session";
import { cellText } from "@/lib/cell-text";
import { attempt, UserError } from "./result";

const MAX_BYTES = 10 * 1024 * 1024;

/** Read the first sheet of an .xlsx file into rows of text, for the import preview. */
export async function readSpreadsheet(projectId: string, form: FormData) {
  return attempt(async () => {
    await requireProjectAction(projectId, "import");
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a file.");
    if (file.size > MAX_BYTES) throw new UserError("That file is over 10 MB. Split it into smaller files.");
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(await file.arrayBuffer());
    } catch {
      throw new UserError("Couldn't read that Excel file. Older .xls files need saving as .xlsx or CSV first.");
    }
    const sheet = book.worksheets.find((w) => w.actualRowCount > 0);
    if (!sheet) throw new UserError("That workbook is empty.");
    const width = sheet.actualColumnCount;
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c)));
      rows.push(cells);
    });
    return { rows, sheetName: sheet.name };
  });
}
