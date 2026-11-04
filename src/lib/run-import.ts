// Importing a test run that was tracked in a spreadsheet (for example a
// Google Sheet used while the test management tool was down). The sheet has
// one row per step; a case's key, title, result and tester sit on its first
// row only. This file reads the sheet into cases; src/server/run-import.ts
// matches them to Flaw Patrol cases and creates the run.

export type ImportStatus = "UNTESTED" | "PASSED" | "FAILED" | "BLOCKED" | "RETEST" | "SKIPPED";

export const RUN_FIELDS = ["key", "title", "step", "stepStatus", "caseStatus", "tester", "actual", "defects"] as const;
export type RunField = (typeof RUN_FIELDS)[number];
export const RUN_FIELD_LABEL: Record<RunField, string> = {
  key: "Case key",
  title: "Case title",
  step: "Step number",
  stepStatus: "Step result",
  caseStatus: "Case result",
  tester: "Tester",
  actual: "Actual / notes",
  defects: "Bugs",
};
export type ColumnMap = Partial<Record<RunField, number>>;

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** Guess which column holds what from the header row. */
export function guessColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  const find = (test: (h: string, raw: string) => boolean) => {
    const i = header.findIndex((h, j) => test(norm(h), h.trim()) && !Object.values(map).includes(j));
    return i >= 0 ? i : undefined;
  };
  map.key = find((h) => ["key", "id", "case key", "case id", "test case id", "pid"].includes(h));
  map.title = find((h) => ["name", "title", "case", "test case", "case title", "test case name", "summary"].includes(h));
  map.step = find((h) => ["step order", "step", "step number", "step no", "step #", "step"].includes(h) || h === "step");
  map.stepStatus = find((h) => ["status", "step status", "step result", "result"].includes(h));
  // qTest exports put the case result under a header that is the run's pass rate, like "58.70%".
  map.caseStatus = find((h, raw) => /^\d+([.,]\d+)?\s*%$/.test(raw) || ["case status", "test status", "case result", "test result", "execution status", "overall"].includes(h));
  map.tester = find((h) => ["executed by", "tester", "tested by", "assignee", "assigned to", "owner", "run by"].includes(h));
  map.actual = find((h) => ["actual result", "actual", "actual results", "notes", "comment", "comments"].includes(h));
  map.defects = find((h) => ["defects", "defect", "bugs", "bug", "jira", "issues", "issue"].includes(h));
  for (const k of RUN_FIELDS) if (map[k] === undefined) delete map[k];
  return map;
}

const STATUS_WORDS: [RegExp, ImportStatus][] = [
  [/^(pass|passed|ok|done|green|p)$/, "PASSED"],
  [/^(fail|failed|f|red|broken)$/, "FAILED"],
  [/^(blocked|block|b|on hold)$/, "BLOCKED"],
  [/^(defective|defect|bug|bug found)$/, "FAILED"],
  [/^(retest|re test|re-test|needs retest)$/, "RETEST"],
  [/^(skip|skipped|n a|na|not applicable|not supported|unsupported)$/, "SKIPPED"],
  // "Select" is what an untouched dropdown in Google Sheets shows (ver_166).
  [/^(untested|not run|not started|to do|todo|pending|incomplete|unexecuted|not executed|select|select one|choose)$/, "UNTESTED"],
];

/** Read a status word from the sheet. Blank, a dash or anything unknown counts as untested, with `known` false for the unknown ones. */
export function readStatus(raw: string): { status: ImportStatus; known: boolean } {
  const s = norm(raw);
  if (!s || /^[-—–]+$/.test(raw.trim())) return { status: "UNTESTED", known: true };
  for (const [re, st] of STATUS_WORDS) if (re.test(s)) return { status: st, known: true };
  return { status: "UNTESTED", known: false };
}

export const isBlankName = (s: string) => !s.trim() || /^[-—–]+$/.test(s.trim());

export type SheetStep = { status: ImportStatus; actual: string };
export type SheetCase = {
  row: number;
  key: string;
  title: string;
  caseStatus: ImportStatus | null;
  tester: string;
  steps: SheetStep[];
  defects: string[];
};

const JIRA_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/**
 * Group the sheet's rows into cases. A row with a key (or a title, when there
 * is no key column) starts a case; rows after it are its steps, in order.
 */
export function readSheet(rows: string[][], map: ColumnMap) {
  const cell = (r: string[], f: RunField) => (map[f] === undefined ? "" : (r[map[f]!] ?? "").trim());
  const cases: SheetCase[] = [];
  const unknownWords = new Set<string>();
  const starter: RunField = map.key !== undefined ? "key" : "title";
  rows.forEach((r, i) => {
    if (r.every((c) => !c.trim())) return;
    let c = cases[cases.length - 1];
    if (cell(r, starter) || !c) {
      const cs = cell(r, "caseStatus");
      const read = cs ? readStatus(cs) : null;
      if (read && !read.known) unknownWords.add(cs);
      c = { row: i + 2, key: cell(r, "key"), title: cell(r, "title"), caseStatus: read ? read.status : null, tester: isBlankName(cell(r, "tester")) ? "" : cell(r, "tester"), steps: [], defects: [] };
      cases.push(c);
    }
    const ss = cell(r, "stepStatus");
    const read = readStatus(ss);
    if (!read.known) unknownWords.add(ss);
    if (map.step === undefined || cell(r, "step") || map.stepStatus !== undefined) c.steps.push({ status: read.status, actual: cell(r, "actual") });
    for (const k of cell(r, "defects").match(JIRA_KEY) ?? []) if (!c.defects.includes(k)) c.defects.push(k);
  });
  return { cases: cases.filter((c) => c.key || c.title), unknownWords: [...unknownWords] };
}

const STATUS_RANK: ImportStatus[] = ["FAILED", "BLOCKED", "RETEST", "PASSED", "SKIPPED", "UNTESTED"];

/**
 * The case's result: the sheet's own case result when it gives one, else
 * worked out from the steps (the worst step wins once every step has a result).
 * Null means the case was started but not finished, so it stays in progress.
 */
export function caseOutcome(c: SheetCase, stepCount: number): ImportStatus | "IN_PROGRESS" {
  const steps = Array.from({ length: stepCount }, (_, i) => c.steps[i]?.status ?? "UNTESTED");
  const done = steps.filter((s) => s !== "UNTESTED").length;
  if (c.caseStatus && c.caseStatus !== "UNTESTED") return c.caseStatus;
  if (done === 0) return "UNTESTED";
  if (done < steps.length) return "IN_PROGRESS";
  return STATUS_RANK.find((s) => steps.includes(s)) ?? "PASSED";
}

/**
 * Match a sheet's tester name to a project member: a name remembered from an
 * earlier import first, then the full name or email, then the first name
 * ("Ryan"), then a short form of it ("Jord" for Jordan). Only a single fit counts.
 */
export function matchTester<M extends { id: string; name: string; email: string }>(raw: string, members: M[], aliases: Record<string, string> = {}): M | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const remembered = aliases[s] && members.find((m) => m.id === aliases[s]);
  if (remembered) return remembered;
  const one = (list: M[]) => (list.length === 1 ? list[0] : null);
  const first = (m: M) => (m.name || m.email).toLowerCase().split(/[\s@.]+/)[0];
  return (
    one(members.filter((m) => m.email.toLowerCase() === s || m.name.toLowerCase() === s)) ??
    one(members.filter((m) => first(m) === s.split(/\s+/)[0] || m.email.toLowerCase().split("@")[0] === s)) ??
    (s.length >= 3 ? one(members.filter((m) => first(m).startsWith(s))) : null)
  );
}

const FINAL_STATUSES = new Set(["PASSED", "FAILED", "BLOCKED", "RETEST", "SKIPPED"]);

/**
 * Adding a sheet to a run in progress (ver_166): what happens to one case.
 * "fill" when it's still untested here (and nobody has started it), "disagree" when both
 * have a final result and they differ (changes only if ticked), "blank" when the sheet has
 * no result (never clears anything), and "skip" for everything already marked here.
 */
export function intoRunAction(here: string, startedHere: boolean, sheet: ImportStatus | "IN_PROGRESS"): "fill" | "disagree" | "blank" | "skip" {
  if (sheet === "UNTESTED") return "blank";
  if (here === "UNTESTED" && !startedHere) return "fill";
  if (FINAL_STATUSES.has(sheet) && FINAL_STATUSES.has(here) && sheet !== here) return "disagree";
  return "skip";
}
