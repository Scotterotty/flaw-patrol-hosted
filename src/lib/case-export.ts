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
  qase: { label: "Qase", ext: "csv", hint: "Import → choose Qase.io", tool: "Qase" },
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

/** Qase's column order. Its importer reads the header row, so names and order must match. */
export const QASE_HEADER = ["v2.id", "title", "description", "preconditions", "postconditions", "tags", "priority", "severity", "type", "behavior", "automation", "status", "is_flaky", "layer", "steps_type", "steps_actions", "steps_result", "steps_data", "milestone_id", "milestone", "suite_id", "suite_parent_id", "suite", "suite_without_cases", "parameters", "is_muted"];

/** One step the way Qase writes it: a JSON string, with / and anything past ASCII escaped. */
function qaseText(t: string): string {
  return JSON.stringify(t ?? "").replace(/\//g, "\\/").replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** "1. \"Open\"\n2. \"Sign in\"\n": every step numbered, each on its own line, even empty ones. */
function qaseSteps(lines: string[]): string {
  return lines.map((t, i) => `${i + 1}. ${qaseText(t)}\n`).join("");
}

/**
 * Qase's CSV import (the current "Qase.io" format, not the deprecated "Qase.io CSV"),
 * matched to a file exported from Qase in Nov 2026: the folders first as suite rows
 * (suite_without_cases = 1, suite_parent_id for nesting), then one row per case with its
 * steps numbered in steps_actions, steps_result and steps_data.
 */
export function qaseTable(cases: ExportCase[]): Table {
  const ids = new Map<string, number>();
  const suiteRows: Cell[][] = [];
  const blank = () => QASE_HEADER.map((): Cell => "");
  const at = (h: string) => QASE_HEADER.indexOf(h);
  const idOf = (path: string[]): number => {
    const k = path.join("\u0000");
    const known = ids.get(k);
    if (known) return known;
    const parent = path.length > 1 ? idOf(path.slice(0, -1)) : "";
    const id = ids.size + 1;
    ids.set(k, id);
    const row = blank();
    row[at("suite_id")] = id;
    row[at("suite_parent_id")] = parent;
    row[at("suite")] = path.at(-1)!;
    row[at("suite_without_cases")] = 1;
    suiteRows.push(row);
    return id;
  };
  const caseRows: Cell[][] = cases.map((c) => {
    const suiteId = c.folder.length ? idOf(c.folder) : "";
    const parentId = c.folder.length > 1 ? idOf(c.folder.slice(0, -1)) : "";
    const steps = c.steps.filter((s) => s.action || s.expected);
    const v: Record<string, Cell> = {
      title: c.title,
      description: [c.requirements.length ? `Requirements: ${c.requirements.join(", ")}` : "", `Flaw Patrol ${c.key}`].filter(Boolean).join("\n"),
      preconditions: c.preconditions,
      tags: c.tags.join(","),
      priority: c.priority === "CRITICAL" ? "high" : c.priority.toLowerCase(),
      severity: c.priority === "CRITICAL" ? "critical" : "normal",
      type: "other",
      behavior: "undefined",
      automation: c.automated ? "automated" : "is-not-automated",
      status: "actual",
      is_flaky: "no",
      layer: "unknown",
      steps_type: "classic",
      steps_actions: steps.length ? qaseSteps(steps.map(action)) : "",
      steps_result: steps.length ? qaseSteps(steps.map((s) => s.expected)) : "",
      steps_data: steps.length ? qaseSteps(steps.map(() => "")) : "",
      suite_id: suiteId,
      suite_parent_id: parentId,
      suite: c.folder.at(-1) ?? "",
      is_muted: "no",
    };
    return QASE_HEADER.map((h) => v[h] ?? "");
  });
  const rows = [...suiteRows, ...caseRows];
  return { header: QASE_HEADER, rows, starts: caseRows.map((_, i) => suiteRows.length + i) };
}

export function tableFor(format: ExportFormat, cases: ExportCase[]): Table {
  return format === "qase" ? qaseTable(cases) : format === "qtest" ? qtestTable(cases) : format === "testrail" ? testrailTable(cases) : sheetTable(cases);
}

/**
 * CSV with a byte order mark, so Excel reads £, é and emoji right. Qase's files have
 * none and use plain line breaks; a mark in front of "v2.id" would hide Qase's header.
 */
export function csvFile(t: Table, format?: ExportFormat): string {
  if (format === "qase") return `${toCsv([t.header, ...t.rows], "\n")}\n`;
  return `\uFEFF${toCsv([t.header, ...t.rows])}`;
}

/** "Web cases - Qase - Nov 6 2026.csv". Characters files can't hold are dropped. */
export function exportFileName(place: string, format: ExportFormat, when: Date, timeZone?: string): string {
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(when).replace(",", "");
  const info = FORMAT_INFO[format];
  const name = `${place} cases - ${info.tool} - ${date}`.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${name}.${info.ext}`;
}
