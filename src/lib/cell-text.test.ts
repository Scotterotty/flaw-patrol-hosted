import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { cellText } from "./cell-text";

describe("cellText (ver_135)", () => {
  it("reads every kind of cell, including an empty merged block that made exceljs throw", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Cases");
    sheet.addRow(["Title", "Steps", "Expected", "Date", "Formula", "Link", "Rich"]);
    sheet.addRow([
      "Upload",
      null,
      null,
      new Date(Date.UTC(2026, 10, 1)),
      { formula: "1+1", result: 2 },
      { text: "Docs", hyperlink: "https://example.com" },
      { richText: [{ text: "Bold " }, { text: "words" }] },
    ]);
    sheet.mergeCells("B2:C2");
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await book.xlsx.writeBuffer());
    const row = loaded.worksheets[0].getRow(2);
    expect(() => row.getCell(3).text).toThrow();
    expect([1, 2, 3, 5, 6, 7].map((c) => cellText(row.getCell(c)))).toEqual(["Upload", "", "", "2", "Docs", "Bold words"]);
    expect(cellText(row.getCell(4))).toMatch(/2026|Nov/);
  });

  it("falls back to the value when text throws", () => {
    const broken = (value: ExcelJS.CellValue) => ({
      get text(): string {
        throw new TypeError("Cannot read properties of null (reading 'toString')");
      },
      value,
    });
    expect(cellText(broken(null))).toBe("");
    expect(cellText(broken({ formula: "A1", result: "Hi" } as ExcelJS.CellValue))).toBe("Hi");
    expect(cellText(broken(new Date(Date.UTC(2026, 10, 1))))).toBe("2026-11-01");
  });
});
