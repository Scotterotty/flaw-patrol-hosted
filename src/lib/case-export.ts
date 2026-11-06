import type { Priority } from "@prisma/client";
import { toCsv } from "./csv";
import { PRIORITY_LABEL } from "./format";
import type { ExpandedStep } from "./steps";

// Export cases (ver_190): the Case library's cases as a file another tool's import
// screen reads without column matching. Pure, so it is unit tested without a database.

export const EXPORT_FORMATS = ["sheet", "qase", "qtest", "testrail"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: "xlsx" | "csv"; hint: string; tool: string }> = {
  sheet: { label: "Excel or Google Sheets", ext: "xlsx", hint: "one row per step", tool: "Spreadsheet" },
  qase: { label: "Qase", ext: "csv", hint: "Repository → Import", tool: "Qase" },
  qtest: { label: "qTest", ext: "xlsx", hint: "Test Design → Import", tool: "qTest" },
  testrail: { label: "TestRail", ext: "csv", hint: "Import Cases", tool: "TestRail" },
};

export const isExportFormat = (v: unknown): v is ExportFormat => typeof v === "string" && (EXPORT_FORMATS as readonly string[]).includes(v);

export type ExportCase = {
  /** Flaw Patrol's key, like WEB-12. */
  key: string;
  /** The key in the tool it was imported from, such as qTest's PQ-1708. */
  sourceKey: string | null;
  title: string;
  /** Folder names from the top, like ["Web", "Login"]. */
  folder: string[];
  preconditions: string;
  priority: Priority;
  automated: boolean;
  automationId: string | null;
  tags: string[];
  /** Jira stories this case tests. */
  requirements: string[];
  /** Shared steps written out, test data rows filled in. */
  steps: ExpandedStep[];
};

export type Cell = string | number;
export type Table = { header: string[]; rows: Cell[][]; /** Row indexes (in rows) where a new case starts. */ starts: number[] };

/** "Row 2: Sign in" for a case with test data, so each row's steps stay apart in tools without rows. */
function action(s: ExpandedStep): string {
  return s.row !== undefined ? `Row ${s.row + 1}: ${s.action}` : s.action;
}

/** "3" or "Row 2, 3" for the step number column. */
function stepNo(s: ExpandedStep, i: number): string {
  const n = s.number || String(i + 1);
  return s.row !== undefined ? `Row ${s.row + 1}, ${n}` : n;
}

/** Steps as numbered lines in one cell, for tools that keep a case on one row. */
function numbered(lines: string[]): string {
  return lines.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

/** Every case on its first row, its steps under it: the layout the spreadsheet, qTest and TestRail share. */
function perStep(cases: ExportCase[], header: string[], caseCells: (c: ExportCase) => Cell[], stepCells: (s: ExpandedStep, i: number) => Cell[]): Table {
  const rows: Cell[][] = [];
  const starts: number[] = [];
  const blank = caseCells(cases[0] ?? emptyCase()).map(() => "");
  for (const c of cases) {
    starts.push(rows.length);
    const steps = c.steps.length ? c.steps : [{ number: "", action: "", expected: "" } as ExpandedStep];
    steps.forEach((s, i) => rows.push([...(i === 0 ? caseCells(c) : blank), ...stepCells(s, i)]));
  }
  return { header, rows, starts };
}

function emptyCase(): ExportCase {
  return { key: "", sourceKey: null, title: "", folder: [], preconditions: "", priority: "MEDIUM", automated: false, automationId: null, tags: [], requirements: [], steps: [] };
}

/** Excel or Google Sheets: readable by people, one row per step. */
export function sheetTable(cases: ExportCase[]): Table {
  return perStep(
    cases,
    ["ID", "Title", "Folder", "Preconditions", "Priority", "Tags", "Requirements", "Automation ID", "Step", "Action", "Expected result"],
    (c) => [c.key, c.title, c.folder.join(" / "), c.preconditions, PRIORITY_LABEL[c.priority], c.tags.join(", "), c.requirements.join(", "), c.automationId ?? ""],
    (s, i) => [s.action || s.expected ? stepNo(s, i) : "", action(s), s.expected],
  );
}

/**
 * qTest's Excel import: the case's fields on its first row, one test step per row below,
 * like the team's qTest cycle sheets. Module is the folder path; Id keeps an imported PQ key.
 */
export function qtestTable(cases: ExportCase[]): Table {
  return perStep(
    cases,
    ["Id", "Name", "Module", "Precondition", "Priority", "Type", "Description", "Test Step #", "Test Step Description", "Test Step Expected Result"],
    (c) => [c.sourceKey ?? "", c.title, c.folder.join("/"), c.preconditions, PRIORITY_LABEL[c.priority], c.automated ? "Automation" : "Manual", [c.requirements.length ? `Requirements: ${c.requirements.join(", ")}` : "", `Flaw Patrol ${c.key}`].filter(Boolean).join("\n")],
    (s, i) => [s.action || s.expected ? stepNo(s, i) : "", action(s), s.expected],
  );
}

/**
 * TestRail's CSV import for "Test Case (Steps)": the case on its first row and one step
 * per row, read with "Steps (Separated)" and "multiple rows per case".
 */
export function testrailTable(cases: ExportCase[]): Table {
  return perStep(
    cases,
    ["ID", "Title", "Section", "Section Hierarchy", "Priority", "Type", "Preconditions", "References", "Automation ID", "Steps (Step)", "Steps (Expected Result)"],
    (c) => [c.key, c.title, c.folder.at(-1) ?? "", c.folder.join(" > "), PRIORITY_LABEL[c.priority], c.automated ? "Automated" : "Functional", c.preconditions, c.requirements.join(", "), c.automationId ?? ""],
    (s) => [action(s), s.expected],
  );
}

/**
 * Qase's CSV import: one row per case, its steps numbered in steps_actions and
 * steps_result. Folders become suites: each gets an id, with suite_parent_id for nesting,
 * so Qase rebuilds the same tree.
 */
export function qaseTable(cases: ExportCase[]): Table {
  const ids = new Map<string, number>();
  const idOf = (path: string[]) => {
    const k = path.join("\u0000");
    if (!ids.has(k)) ids.set(k, ids.size + 1);
    return ids.get(k)!;
  };
  const rows: Cell[][] = cases.map((c) => {
    const suiteId = c.folder.length ? idOf(c.folder) : "";
    const parentId = c.folder.length > 1 ? idOf(c.folder.slice(0, -1)) : "";
    const steps = c.steps.filter((s) => s.action || s.expected);
    return [
      c.title,
      c.folder.at(-1) ?? "",
      suiteId,
      parentId,
      c.preconditions,
      [c.requirements.length ? `Requirements: ${c.requirements.join(", ")}` : "", `Flaw Patrol ${c.key}`].filter(Boolean).join("\n"),
      c.priority === "CRITICAL" ? "high" : c.priority.toLowerCase(),
      c.priority === "CRITICAL" ? "critical" : "normal",
      c.automated ? "automated" : "manual",
      c.tags.join(","),
      "classic",
      numbered(steps.map(action)),
      numbered(steps.map((s) => s.expected)),
    ];
  });
  return {
    header: ["title", "suite", "suite_id", "suite_parent_id", "preconditions", "description", "priority", "severity", "automation", "tags", "steps_type", "steps_actions", "steps_result"],
    rows,
    starts: rows.map((_, i) => i),
  };
}

export function tableFor(format: ExportFormat, cases: ExportCase[]): Table {
  return format === "qase" ? qaseTable(cases) : format === "qtest" ? qtestTable(cases) : format === "testrail" ? testrailTable(cases) : sheetTable(cases);
}

/** CSV with a byte order mark, so Excel reads £, é and emoji right. */
export function csvFile(t: Table): string {
  return `\uFEFF${toCsv([t.header, ...t.rows])}`;
}

/** "Web cases - Qase - Nov 6 2026.csv". Characters files can't hold are dropped. */
export function exportFileName(place: string, format: ExportFormat, when: Date, timeZone?: string): string {
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(when).replace(",", "");
  const info = FORMAT_INFO[format];
  const name = `${place} cases - ${info.tool} - ${date}`.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${name}.${info.ext}`;
}
