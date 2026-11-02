import type { ResultStatus } from "@prisma/client";
import { z } from "zod";

// Test data: an optional small table under a case's steps. Each column name is a
// {{blank}} in the steps, and the case runs once per row with that row's values filled in.
// Pure, so the editor, the server actions, the snapshot and the runner all share it.

export const MAX_ROWS = 20;
export const MAX_COLUMNS = 12;
export const MAX_VALUE = 500;

/** A column name is one word: letters, numbers or _, starting with a letter or _. */
export const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type TestData = { columns: string[]; rows: string[][] };

export const testDataSchema = z
  .object({
    columns: z.array(z.string().max(50).regex(COLUMN_NAME, "Column names are one word: letters, numbers or _.")).max(MAX_COLUMNS),
    rows: z.array(z.array(z.string().max(MAX_VALUE))).max(MAX_ROWS, `Test data holds up to ${MAX_ROWS} rows.`),
  })
  .refine((d) => new Set(d.columns.map((c) => c.toLowerCase())).size === d.columns.length, "Two columns have the same name.")
  .refine((d) => d.rows.every((r) => r.length === d.columns.length), "Every row needs a value box for each column.");

/** Turn what someone typed into a column name: spaces become _, other characters drop out. */
export function toColumnName(typed: string): string {
  const s = typed.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
  return /^[0-9]/.test(s) ? `_${s}` : s;
}

/** Saved test data, or null when the case has none (no columns or no rows). Rows that are all blank drop out. */
export function parseTestData(json: unknown): TestData | null {
  const parsed = testDataSchema.safeParse(json);
  if (!parsed.success) return null;
  const { columns } = parsed.data;
  const rows = parsed.data.rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!columns.length || !rows.length) return null;
  return { columns, rows: rows.map((r) => r.map((v) => v.trim())) };
}

/** Tidy test data to save: null when there's nothing in it. */
export function cleanTestData(d: TestData | null | undefined): TestData | null {
  return d ? parseTestData(d) : null;
}

const BLANK = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** A row's values by column name. */
export function rowValues(d: TestData, row: number): Record<string, string> {
  return Object.fromEntries(d.columns.map((c, i) => [c, d.rows[row]?.[i] ?? ""]));
}

/** Fill a row's values into {{blanks}}. Blanks with no column, or an empty value, stay as they are. */
export function fillRow(text: string, d: TestData, row: number): string {
  const values = rowValues(d, row);
  return text.replace(BLANK, (whole, name: string) => {
    const v = values[name];
    return v !== undefined && v !== "" ? v : whole;
  });
}

/** The values this text took from the row, in order, for the runner to show in blue. */
export function valuesUsed(text: string, d: TestData, row: number): string[] {
  const values = rowValues(d, row);
  const out: string[] = [];
  for (const m of text.matchAll(BLANK)) {
    const v = values[m[1]];
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Short label for a row: its first few values, like "Safari · viewer · staging". */
export function rowLabel(d: TestData, row: number, max = 3): string {
  const vals = (d.rows[row] ?? []).filter((v) => v !== "");
  if (!vals.length) return "(empty row)";
  const shown = vals.slice(0, max).join(" · ");
  return vals.length > max ? `${shown} …` : shown;
}

/** Every value of a row spelled out, like "browser = Safari, role = viewer". */
export function rowSummary(d: TestData, row: number): string {
  return d.columns.map((c, i) => `${c} = ${d.rows[row]?.[i] || "(blank)"}`).join(", ");
}

/** Every {{blank}} name used in some text, in first-seen order. */
export function blanksIn(texts: string[]): string[] {
  const seen = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(BLANK)) seen.add(m[1]);
  return [...seen];
}

/**
 * What to warn about while editing: columns no step uses, and blanks in plain steps with no
 * column. Shared step blanks with no column ask for one value instead, so they're not listed.
 */
export function testDataWarnings(d: TestData | null, plainTexts: { step: number; text: string }[], sharedBlanks: string[]) {
  if (!d || !d.columns.length) return { unusedColumns: [] as string[], missing: [] as { name: string; step: number }[] };
  const cols = new Set(d.columns);
  const usedInPlain = blanksIn(plainTexts.map((t) => t.text));
  const used = new Set([...usedInPlain, ...sharedBlanks]);
  const unusedColumns = d.columns.filter((c) => c && !used.has(c));
  const missing: { name: string; step: number }[] = [];
  for (const t of plainTexts)
    for (const name of blanksIn([t.text])) if (!cols.has(name) && !missing.some((m) => m.name === name)) missing.push({ name, step: t.step });
  return { unusedColumns, missing };
}

const WORST: ResultStatus[] = ["FAILED", "BLOCKED", "RETEST", "SKIPPED"];

/**
 * A row's result, or the case's from its rows: Passed only when every one passed. Otherwise the
 * worst one wins (Failed, Blocked, Retest, Skipped). Anything not done yet keeps it In progress,
 * and nothing done at all is Untested.
 */
export function combineResults(statuses: ResultStatus[]): ResultStatus {
  if (!statuses.length) return "UNTESTED";
  const done: ResultStatus[] = statuses.filter((s) => s !== "UNTESTED" && s !== "IN_PROGRESS");
  if (!done.length) return statuses.includes("IN_PROGRESS") ? "IN_PROGRESS" : "UNTESTED";
  if (done.length < statuses.length) return "IN_PROGRESS";
  for (const w of WORST) if (done.includes(w)) return w;
  return done.every((s) => s === "PASSED") ? "PASSED" : done[0];
}

/** Results for each row, from the step results of a case run with test data. `rowOf[i]` is step i's row. */
export function rowResults(rowOf: (number | undefined)[], statuses: ResultStatus[], rowCount: number): ResultStatus[] {
  return Array.from({ length: rowCount }, (_, r) => {
    const mine = statuses.filter((_, i) => rowOf[i] === r);
    if (!mine.length) return "UNTESTED";
    // A row with some steps marked and the rest untested works like a case: its marked steps decide.
    const marked: ResultStatus[] = mine.filter((s) => s !== "UNTESTED");
    if (!marked.length) return "UNTESTED";
    for (const w of WORST) if (marked.includes(w)) return w;
    return marked.length === mine.length ? "PASSED" : "IN_PROGRESS";
  });
}

/** "2 of 3 rows passed" style line for history and tooltips. */
export function rowsLine(results: ResultStatus[]): string {
  const passed = results.filter((s) => s === "PASSED").length;
  return `${passed} of ${results.length} ${results.length === 1 ? "row" : "rows"} passed`;
}

/** Read test data pasted from Google Sheets or Excel (tab separated), or a CSV line per row. */
export function parsePasted(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const tabbed = lines.some((l) => l.includes("\t"));
  return lines.map((l) => (tabbed ? l.split("\t") : l.split(",")).map((v) => v.trim()));
}

/**
 * Add pasted rows to a table. An empty table takes the first pasted row as its column names.
 * Returns the new table and how many rows didn't fit under the cap.
 */
export function addPasted(d: TestData, pasted: string[][]): { data: TestData; cut: number } {
  if (!pasted.length) return { data: d, cut: 0 };
  let columns = d.columns;
  let rows = d.rows.filter((r) => r.some((v) => v.trim() !== ""));
  let body = pasted;
  // A table with nothing filled in yet takes the first pasted row as its column names.
  if (!columns.length || !rows.length) {
    const names: string[] = [];
    for (const raw of pasted[0]) {
      let name = toColumnName(raw) || `column${names.length + 1}`;
      while (names.some((n) => n.toLowerCase() === name.toLowerCase())) name = `${name}_2`;
      names.push(name);
    }
    columns = names.slice(0, MAX_COLUMNS);
    rows = [];
    body = pasted.slice(1);
  }
  const fitted = body.map((r) => columns.map((_, i) => (r[i] ?? "").slice(0, MAX_VALUE)));
  const room = Math.max(0, MAX_ROWS - rows.length);
  return { data: { columns, rows: [...rows, ...fitted.slice(0, room)] }, cut: Math.max(0, fitted.length - room) };
}

/** What changed in the table between two versions, in words, for Compare versions. */
export function testDataChanges(before: TestData | null, after: TestData | null): string[] {
  if (!before && !after) return [];
  if (!before) return [`Test data added: ${after!.rows.length} ${after!.rows.length === 1 ? "row" : "rows"}.`];
  if (!after) return ["Test data removed."];
  const out: string[] = [];
  const addedCols = after.columns.filter((c) => !before.columns.includes(c));
  const goneCols = before.columns.filter((c) => !after.columns.includes(c));
  if (addedCols.length) out.push(`Column ${addedCols.join(", ")} added.`);
  if (goneCols.length) out.push(`Column ${goneCols.join(", ")} removed.`);
  if (before.rows.length !== after.rows.length) out.push(`Rows: ${before.rows.length} → ${after.rows.length}.`);
  else if (!addedCols.length && !goneCols.length && JSON.stringify(before.rows) !== JSON.stringify(after.rows)) out.push("Values changed.");
  return out;
}

/** What stops a table from saving, in plain words, or null when it's fine. */
export function testDataProblem(d: TestData | null): string | null {
  if (!d) return null;
  if (!d.columns.length) return "Test data needs at least one column. Add one, or click Remove test data.";
  if (d.columns.some((c) => !c.trim())) return "Give every Test data column a name.";
  if (d.columns.some((c) => !COLUMN_NAME.test(c))) return "Test data column names are one word: letters, numbers or _.";
  if (new Set(d.columns.map((c) => c.toLowerCase())).size !== d.columns.length) return "Two Test data columns have the same name.";
  if (!d.rows.some((r) => r.some((v) => v.trim() !== ""))) return "Test data has no values yet. Fill in a row, or click Remove test data.";
  if (d.rows.filter((r) => r.some((v) => v.trim() !== "")).length > MAX_ROWS) return `Test data holds up to ${MAX_ROWS} rows. Split the rest into another case.`;
  return null;
}
