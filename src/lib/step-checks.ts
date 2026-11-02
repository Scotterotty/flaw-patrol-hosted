import type { ResultStatus } from "@prisma/client";
import type { ExpandedStep } from "./steps";

// Results for each check inside a shared step. Imported shared steps often pack several
// checks into one step: a name on the first line, then one check per line. The runner gives each
// check its own result and the step's result rolls up from them. Nothing is stored on the shared
// step itself; the lines are read as they are, every time.

export type CheckLine = { text: string } | { label: string };

export type StepChecks =
  /** A row like "SEARCH BAR SHARED STEPS": shown as a heading, no result needed. */
  | { kind: "heading"; text: string }
  | {
      kind: "checks";
      title: string;
      /** Checks and the small labels over them, in order. */
      lines: CheckLine[];
      /** How many lines are checks (labels don't count). */
      count: number;
      /** What's left of Expected once checks and platform lines are taken out. */
      expected: string;
      /** From "Not supported by: UNREAL / UNITY" lines. */
      notOn: string[];
    };

const NOT_ON = /^not supported by:?\s*/i;
const ends = (l: string) => /[.!?)]$/.test(l.trim());
const short = (l: string) => l.trim().split(/\s+/).length <= 4;
const lines = (t: string) =>
  t
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

/** Plain lines to checks: a line ending in a colon keeps its short list, a short line over checks becomes a label. */
export function toChecks(ls: string[]): CheckLine[] {
  const out: CheckLine[] = [];
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (l.endsWith(":")) {
      const items: string[] = [];
      while (i + 1 < ls.length && !ends(ls[i + 1]) && !ls[i + 1].endsWith(":") && short(ls[i + 1])) items.push(ls[++i]);
      out.push({ text: items.length ? `${l} ${items.join(", ")}` : l });
    } else if (!ends(l) && short(l) && i + 1 < ls.length && ends(ls[i + 1])) out.push({ label: l });
    else out.push({ text: l });
  }
  return out;
}

const titleCase = (l: string) => l.split(/\s+/).every((w) => !/^[a-z]/.test(w));
const allCaps = (l: string) => /[A-Z]/.test(l) && l === l.toUpperCase();

/**
 * How a step reads as checks, or null when it works like any other step: not from a shared step,
 * or fewer than two checks in it. `first` is true for the first step of its shared step.
 */
export function stepChecks(step: Pick<ExpandedStep, "action" | "expected" | "shared">, first = false): StepChecks | null {
  if (!step.shared) return null;
  const action = lines(step.action);
  const notOn: string[] = [];
  const expected: string[] = [];
  for (const l of lines(step.expected)) {
    if (!NOT_ON.test(l)) {
      expected.push(l);
      continue;
    }
    // "Not supported by: UNREAL" may run straight into a sentence ("…UNITYUser can log in").
    const m = l.replace(NOT_ON, "").replace(/\.$/, "");
    const cut = m.match(/^([A-Z &/,]+?)(?=[A-Z][a-z]|$)/);
    const platforms = (cut ? cut[1] : m).trim();
    if (platforms) notOn.push(...platforms.split(/\s*(?:\/|&|,)\s*/).filter(Boolean));
    const rest = cut ? m.slice(cut[1].length).trim() : "";
    if (rest) expected.push(rest);
  }
  if (action.length === 1 && !expected.length && !notOn.length && !ends(action[0]) && (allCaps(action[0]) || (first && short(action[0]) && titleCase(action[0]))))
    return { kind: "heading", text: action[0] };
  let checks: CheckLine[] = [];
  let rest = expected.join("\n");
  if (action.length > 1) checks = toChecks(action.slice(1));
  else if (expected.length > 1 && !expected.some((l) => /^(OR|AND)$/.test(l))) {
    checks = toChecks(expected);
    rest = "";
  }
  const count = checks.filter((c) => "text" in c).length;
  if (count < 2) return null;
  return { kind: "checks", title: action[0] ?? "", lines: checks, count, expected: rest, notOn: [...new Set(notOn)] };
}

/** The step's result from its checks: any failure fails it, all passed passes it, unfinished stays Untested. */
export function rollUp(checks: ResultStatus[]): ResultStatus {
  for (const s of ["FAILED", "BLOCKED", "RETEST"] as ResultStatus[]) if (checks.includes(s)) return s;
  if (!checks.length || checks.includes("UNTESTED")) return "UNTESTED";
  return checks.every((c) => c === "SKIPPED") ? "SKIPPED" : "PASSED";
}

/** Pressing a step's own button: fills the empty checks, or sets them all when none are empty. */
export function fillChecks(checks: ResultStatus[], status: ResultStatus): ResultStatus[] {
  if (status === "UNTESTED") return checks.map(() => "UNTESTED");
  const empty = checks.includes("UNTESTED");
  return checks.map((c) => (empty ? (c === "UNTESTED" ? status : c) : status));
}

/** The step opens a shared step's run of steps (the first of 3.1, 3.2…). */
export const firstOfShared = (steps: Pick<ExpandedStep, "number" | "shared">[], i: number) =>
  !!steps[i].shared && (i === 0 || steps[i - 1].shared?.id !== steps[i].shared!.id || steps[i - 1].number.split(".")[0] !== steps[i].number.split(".")[0]);

/**
 * Which rows of a case's steps (a run entry's saved copy) are headings. They take no result, so
 * the runner skips them and nothing that counts steps should count them.
 */
export function headingRows(steps: unknown): Set<number> {
  const out = new Set<number>();
  if (!Array.isArray(steps)) return out;
  const list = steps.map((s) => {
    const o = (s && typeof s === "object" ? s : {}) as Partial<ExpandedStep>;
    return { action: String(o.action ?? ""), expected: String(o.expected ?? ""), number: String(o.number ?? ""), shared: o.shared };
  });
  list.forEach((s, i) => {
    if (stepChecks(s, firstOfShared(list, i))?.kind === "heading") out.add(i);
  });
  return out;
}

/** A list that runs alongside a case's steps (step results, statuses) without the heading rows. */
export function withoutHeadings<T>(steps: unknown, list: T[]): T[] {
  const headings = headingRows(steps);
  return headings.size ? list.filter((_, i) => !headings.has(i)) : list;
}
