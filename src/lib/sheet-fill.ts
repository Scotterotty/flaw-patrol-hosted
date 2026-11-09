import type { ResultStatus } from "@prisma/client";
import { z } from "zod";

// "Fill in my columns": write a run's results into a Google Sheet the team already
// keeps, without rewriting it. Flaw Patrol reads the tab, finds the header row and the
// columns it can fill, matches each case to a row (by Key, else by title), and sends
// back only the cells to change. The sheet's script then skips any cell a person typed.
// Everything here is plain data in, data out, so it can be tested without Google.

export type FillRole = "result" | "executedBy" | "stepStatus" | "bug" | "summary";
export const FILL_ROLES: FillRole[] = ["result", "executedBy", "stepStatus", "bug", "summary"];
export const ROLE_LABEL: Record<FillRole, string> = {
  result: "Result",
  executedBy: "Executed By",
  stepStatus: "Step Status",
  bug: "Bug Ticket",
  summary: "Summary",
};

/** What a run remembers about filling its sheet. rows: case (run entry id) → sheet row, 0 = skip it. */
export const fillConfigSchema = z.object({
  headerRow: z.number().int().min(1).max(500).nullable().default(null),
  set: z.number().int().min(0).max(20).default(0),
  roles: z.array(z.enum(["result", "executedBy", "stepStatus", "bug", "summary"])).max(5).default(["result", "executedBy", "stepStatus", "bug", "summary"]),
  rows: z.record(z.string().max(40), z.number().int().min(0).max(100000)).default({}),
  /** The columns' names when it was linked ("Columns G to I"), for the run page. */
  label: z.string().max(100).default(""),
});
export type FillConfig = z.infer<typeof fillConfigSchema>;
export function parseFillConfig(json: unknown): FillConfig {
  const parsed = fillConfigSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : fillConfigSchema.parse({});
}

/** The tab as the script reads it: display values row by row (row 1 first), and each column's dropdown words. */
export type SheetGrid = { values: string[][]; lists: (string[] | null)[] };

export type ColumnSet = { label: string; cols: Partial<Record<FillRole, number>> };
export type SheetLayout = {
  headerRow: number;
  keyCol: number | null;
  titleCol: number | null;
  stepCol: number | null;
  /** One row per step, like the RC cycle sheets: case status on the case's first row, step status below. */
  steps: boolean;
  sets: ColumnSet[];
};

/** One case of the run, as the sheet needs it. */
export type FillEntry = {
  id: string;
  keys: string[];
  title: string;
  status: ResultStatus;
  tester: string;
  steps: { number: string; status: ResultStatus }[];
  bugs: { key: string; url: string | null; title: string }[];
  note: string;
};

/** A cell to write: 1-based row and column. links make parts of the text clickable (bug keys). */
export type FillCell = { r: number; c: number; v: string; links?: { text: string; url: string }[] };

const MAX_HEADER_SEARCH = 50;

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const head = (s: string) => norm(s).replace(/ /g, "");

const KEY_NAMES = ["key", "id", "testid", "caseid", "testcaseid", "testkey", "issuekey"];
const TITLE_NAMES = ["test", "title", "name", "testcase", "testname", "case", "testcasename", "testtitle", "scenario", "check", "checklist"];
const STEP_NAMES = ["steporder", "step", "stepno", "stepnumber"];
const ROLE_NAMES: Record<FillRole, string[]> = {
  result: ["result", "results", "casestatus", "outcome", "passfail", "testresult"],
  executedBy: ["executedby", "tester", "testedby", "testers", "executor", "runby"],
  // "Status" is the step's status on a one-row-per-step sheet, and the case's result otherwise.
  stepStatus: ["stepstatus"],
  bug: ["bugticket", "bugtickets", "bug", "bugs", "defects", "defect", "jira", "ticket", "tickets", "bugid", "bugkey", "issue", "issues"],
  summary: ["summary", "notes", "note", "comments", "comment", "actualresult"],
};

/** A column letter: 1 → A, 27 → AA. */
export function colLetter(c: number): string {
  let s = "";
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function rolesOf(name: string, steps: boolean): FillRole | null {
  if (name === "status") return steps ? "stepStatus" : "result";
  for (const role of FILL_ROLES) if (ROLE_NAMES[role].includes(name)) return role;
  return null;
}

/** Finds the header row (the first with a title or key column next to something Flaw Patrol can fill) and the columns to fill. */
export function findLayout(grid: SheetGrid, headerRow: number | null = null): SheetLayout | null {
  const rows = grid.values;
  const tryRow = (r: number): SheetLayout | null => {
    const names = (rows[r - 1] ?? []).map(head);
    const find = (list: string[]) => {
      const i = names.findIndex((n) => list.includes(n));
      return i < 0 ? null : i + 1;
    };
    const keyCol = find(KEY_NAMES);
    // "Summary" is a title only when nothing else is.
    const titleCol = find(TITLE_NAMES) ?? (keyCol ? null : find(["summary"]));
    const stepCol = find(STEP_NAMES);
    if (!keyCol && !titleCol) return null;
    const steps = !!stepCol;
    const byRole: Record<FillRole, number[]> = { result: [], executedBy: [], stepStatus: [], bug: [], summary: [] };
    names.forEach((n, i) => {
      const c = i + 1;
      if (c === keyCol || c === titleCol || c === stepCol) return;
      const role = rolesOf(n, steps);
      if (role) byRole[role].push(c);
    });
    // Flaw Patrol's own cycle layout: the case status sits under a "% done" header, just left of Executed By.
    if (steps && !byRole.result.length) {
      for (const by of byRole.executedBy) {
        const left = rows[r - 1]?.[by - 2] ?? "";
        if (by > 1 && (left.trim() === "" || /^\d+(\.\d+)?%$/.test(left.trim()))) byRole.result.push(by - 1);
      }
    }
    const count = Math.max(0, ...FILL_ROLES.map((role) => byRole[role].length));
    if (!count) return null;
    const sets: ColumnSet[] = [];
    for (let i = 0; i < count; i++) {
      const cols: Partial<Record<FillRole, number>> = {};
      for (const role of FILL_ROLES) {
        const list = byRole[role];
        // A column that appears once belongs to every set (one Executed By beside three Result columns).
        const c = list.length === count ? list[i] : list.length === 1 ? list[0] : list[i];
        if (c) cols[role] = c;
      }
      const used = Object.values(cols) as number[];
      const label = count === 1 ? "These columns" : `Columns ${colLetter(Math.min(...used))} to ${colLetter(Math.max(...used))}`;
      sets.push({ label, cols });
    }
    return { headerRow: r, keyCol, titleCol, stepCol, steps, sets };
  };
  if (headerRow) return tryRow(headerRow);
  for (let r = 1; r <= Math.min(MAX_HEADER_SEARCH, rows.length); r++) {
    const found = tryRow(r);
    if (found) return found;
  }
  return null;
}

const firstLine = (s: string) => s.split(/\r?\n/)[0] ?? "";

/** The rows a case could sit on: rows with a key or a title (section rows and empty rows don't count once matched to nothing). */
export function caseRows(grid: SheetGrid, layout: SheetLayout): { row: number; key: string; title: string }[] {
  const out: { row: number; key: string; title: string }[] = [];
  for (let r = layout.headerRow + 1; r <= grid.values.length; r++) {
    const v = grid.values[r - 1] ?? [];
    const key = layout.keyCol ? (v[layout.keyCol - 1] ?? "").trim() : "";
    const title = layout.titleCol ? (v[layout.titleCol - 1] ?? "").trim() : "";
    if (key || title) out.push({ row: r, key, title });
  }
  return out;
}

export type Match = { rows: Map<string, number>; unmatched: string[]; skipped: string[]; free: { row: number; text: string }[] };

/** Puts each case on a row: picked rows first, then Key, then the exact title, then a cell that starts with the title. */
export function matchEntries(grid: SheetGrid, layout: SheetLayout, entries: FillEntry[], picks: Record<string, number> = {}): Match {
  const candidates = caseRows(grid, layout);
  const taken = new Set<number>();
  const rows = new Map<string, number>();
  const skipped: string[] = [];
  const valid = new Set(candidates.map((c) => c.row));
  for (const e of entries) {
    const pick = picks[e.id];
    if (pick === 0) skipped.push(e.id);
    else if (pick && valid.has(pick) && !taken.has(pick)) {
      rows.set(e.id, pick);
      taken.add(pick);
    }
  }
  const pass = (test: (e: FillEntry, c: (typeof candidates)[number]) => boolean) => {
    for (const e of entries) {
      if (rows.has(e.id) || skipped.includes(e.id)) continue;
      const hit = candidates.find((c) => !taken.has(c.row) && test(e, c));
      if (hit) {
        rows.set(e.id, hit.row);
        taken.add(hit.row);
      }
    }
  };
  if (layout.keyCol) pass((e, c) => !!c.key && e.keys.some((k) => norm(k) === norm(c.key)));
  if (layout.titleCol) {
    pass((e, c) => !!norm(e.title) && (norm(c.title) === norm(e.title) || norm(firstLine(c.title)) === norm(e.title)));
    pass((e, c) => norm(e.title).length >= 4 && norm(c.title).startsWith(norm(e.title) + " "));
  }
  const unmatched = entries.filter((e) => !rows.has(e.id) && !skipped.includes(e.id)).map((e) => e.id);
  const free = candidates.filter((c) => !taken.has(c.row) && (!layout.steps || c.key || c.title)).map((c) => ({ row: c.row, text: [c.key, firstLine(c.title)].filter(Boolean).join(" ").slice(0, 120) }));
  return { rows, unmatched, skipped, free };
}

const WORDS: Record<ResultStatus, string[]> = {
  PASSED: ["passed", "pass", "ok", "yes", "done"],
  FAILED: ["failed", "fail", "defective", "no"],
  BLOCKED: ["blocked", "block"],
  RETEST: ["retest", "re test", "in progress"],
  SKIPPED: ["not run", "skipped", "skip", "n a", "na"],
  IN_PROGRESS: ["in progress", "wip", "started"],
  EXPLORED: ["explored", "passed", "pass"],
  UNTESTED: ["untested", "not tested", "to do", "todo"],
};
// When the sheet has no words of its own: the cycle sheets' spelling, and nothing for untested.
const DEFAULT_WORD: Record<ResultStatus, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  RETEST: "Retest",
  SKIPPED: "Not Run",
  IN_PROGRESS: "In Progress",
  EXPLORED: "Explored",
  UNTESTED: "",
};

/** The sheet's own word for a status, from its dropdown or what's already in its columns ("Pass" rather than "Passed"). */
export function sheetWord(status: ResultStatus, vocab: string[]): string {
  for (const want of WORDS[status]) {
    const hit = vocab.find((w) => norm(w) === want);
    if (hit) return hit;
  }
  return DEFAULT_WORD[status];
}

/**
 * The sheet's own name for a tester, from its dropdown or what's already in the column:
 * "Scott Smith" becomes "Scott" or "scott smith" when that's how the sheet writes it.
 * A sheet whose dropdown only takes its own names would refuse anything else.
 */
export function sheetName(tester: string, vocab: string[]): string {
  const want = norm(tester);
  if (!want) return tester;
  const exact = vocab.find((w) => norm(w) === want);
  if (exact) return exact;
  const [first, ...rest] = want.split(" ");
  const last = rest.at(-1)?.[0];
  const one = (hits: string[]) => (hits.length === 1 ? hits[0] : undefined);
  return (
    // The sheet uses first names ("Scott").
    one(vocab.filter((w) => norm(w) === first)) ??
    // Same first name, and the last names don't disagree ("Scott S.", or the sheet's full name when Flaw Patrol has a first name only).
    one(
      vocab.filter((w) => {
        const [f, ...r] = norm(w).split(" ");
        return f === first && r.length > 0 && (!last || r.at(-1)![0] === last);
      }),
    ) ??
    tester
  );
}

/** Words a column already uses: its dropdown, plus what's written in it and in other columns of the same kind. */
export function vocabulary(grid: SheetGrid, layout: SheetLayout, role: FillRole): string[] {
  const cols = new Set(layout.sets.map((s) => s.cols[role]).filter((c): c is number => !!c));
  const words = new Set<string>();
  for (const c of cols) for (const w of grid.lists[c - 1] ?? []) words.add(w);
  for (let r = layout.headerRow + 1; r <= grid.values.length && words.size < 60; r++) {
    for (const c of cols) {
      const v = (grid.values[r - 1]?.[c - 1] ?? "").trim();
      if (v && v.length <= 30) words.add(v);
    }
  }
  return [...words];
}

/** Where each step of a matched case sits: rows under the case row (up to the next case), by Step Order, else in order. */
export function stepRows(grid: SheetGrid, layout: SheetLayout, caseRow: number, entry: FillEntry): Map<number, number> {
  const out = new Map<number, number>();
  if (!layout.steps) return out;
  const starts = new Set(caseRows(grid, layout).filter((c) => c.key || c.title).map((c) => c.row));
  const block: { row: number; order: string }[] = [];
  for (let r = caseRow; r <= grid.values.length; r++) {
    if (r > caseRow && starts.has(r)) break;
    block.push({ row: r, order: (layout.stepCol ? grid.values[r - 1]?.[layout.stepCol - 1] : "")?.trim() ?? "" });
  }
  entry.steps.forEach((s, i) => {
    const byOrder = s.number ? block.find((b) => b.order === s.number) : undefined;
    const row = byOrder?.row ?? block[i]?.row;
    if (row) out.set(i, row);
  });
  return out;
}

/** The cells to send: only the picked columns of the chosen set, on matched rows. */
export function planCells(grid: SheetGrid, layout: SheetLayout, config: FillConfig, entries: FillEntry[], match: Match): FillCell[] {
  const set = layout.sets[config.set] ?? layout.sets[0];
  if (!set) return [];
  const on = (role: FillRole) => (config.roles.includes(role) ? set.cols[role] : undefined);
  const vocab = Object.fromEntries(FILL_ROLES.map((role) => [role, vocabulary(grid, layout, role)])) as Record<FillRole, string[]>;
  const cells: FillCell[] = [];
  for (const e of entries) {
    const row = match.rows.get(e.id);
    if (!row) continue;
    const tested = e.status !== "UNTESTED";
    const col = {
      result: on("result"),
      executedBy: on("executedBy"),
      bug: on("bug"),
      summary: on("summary"),
      stepStatus: on("stepStatus"),
    };
    if (col.result) cells.push({ r: row, c: col.result, v: sheetWord(e.status, vocab.result) });
    if (col.executedBy) cells.push({ r: row, c: col.executedBy, v: tested ? sheetName(e.tester, vocab.executedBy) : vocab.executedBy.includes("—") ? "—" : "" });
    if (col.bug) {
      const keys = tested ? e.bugs.map((b) => b.key) : [];
      const links = tested ? e.bugs.filter((b) => b.url).map((b) => ({ text: b.key, url: b.url! })) : [];
      cells.push({ r: row, c: col.bug, v: keys.join(", "), ...(links.length ? { links } : {}) });
    }
    if (col.summary) {
      const bad = e.status === "FAILED" || e.status === "BLOCKED" || e.status === "RETEST";
      const text = bad ? e.note.trim() || e.bugs.map((b) => b.title).join("; ") : "";
      cells.push({ r: row, c: col.summary, v: text.slice(0, 500) });
    }
    if (col.stepStatus && layout.steps) {
      for (const [i, r] of stepRows(grid, layout, row, e)) cells.push({ r, c: col.stepStatus, v: sheetWord(e.steps[i].status, vocab.stepStatus) });
    }
  }
  // Never a formula in someone else's sheet.
  return cells.map((cell) => (/^[=+\-@]/.test(cell.v) && cell.v !== "—" ? { ...cell, v: `'${cell.v}` } : cell));
}

/** Plain words for what a link fills, for the dialog and the run page. */
export function describeFill(layout: SheetLayout, config: FillConfig): string {
  const set = layout.sets[config.set] ?? layout.sets[0];
  if (!set) return "";
  const names = FILL_ROLES.filter((r) => config.roles.includes(r) && set.cols[r]).map((r) => ROLE_LABEL[r]);
  if (!names.length) return "nothing yet";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What a linked run fills, for the run page: "Result and Bug Ticket (Columns G to I)". */
export function fillWords(json: unknown): string {
  const config = parseFillConfig(json);
  const names = FILL_ROLES.filter((r) => config.roles.includes(r)).map((r) => ROLE_LABEL[r]);
  const list = names.length <= 1 ? (names[0] ?? "nothing") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return config.label && config.label !== "These columns" ? `${list} (${config.label.replace(/^Columns/, "columns")})` : list;
}
