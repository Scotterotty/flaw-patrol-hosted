import type { Cell, CellValue } from "exceljs";

/**
 * A spreadsheet cell as plain text. exceljs's `cell.text` throws on some cells Excel writes, such
 * as an empty block of merged cells (ver_135: Excel imports said "Something went wrong"), so
 * fall back to reading the value ourselves.
 */
export function cellText(cell: Pick<Cell, "text" | "value">): string {
  try {
    return cell.text ?? "";
  } catch {
    return valueText(cell.value);
  }
}

function valueText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== "object") return String(v);
  if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text ?? "").join("");
  if ("text" in v && typeof v.text === "string") return v.text; // hyperlink
  if ("error" in v) return String(v.error ?? "");
  if ("result" in v) return valueText(v.result as CellValue);
  return "";
}
