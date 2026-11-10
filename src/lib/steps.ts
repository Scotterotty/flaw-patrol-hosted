import { z } from "zod";
import { fillRow, valuesUsed, type TestData } from "./test-data";
import { isSectionTitle } from "./step-checks";

// Step data shared by the editor, the server actions, CSV import and (later)
// the execution view. Kept free of database imports so it can run anywhere.

export const plainStepSchema = z.object({
  action: z.string().max(5000),
  expected: z.string().max(5000).default(""),
});
export type PlainStep = z.infer<typeof plainStepSchema>;

export const caseStepItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("step"), action: z.string().max(5000), expected: z.string().max(5000).default("") }),
  z.object({
    kind: z.literal("shared"),
    sharedStepId: z.string().min(1),
    params: z.record(z.string(), z.string().max(1000)).default({}),
  }),
]);
export type CaseStepItem = z.infer<typeof caseStepItemSchema>;

export const sharedStepParamSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use letters, digits and underscores, starting with a letter"),
  defaultValue: z.string().max(1000).default(""),
});
export type SharedStepParam = z.infer<typeof sharedStepParamSchema>;

export function parseCaseSteps(json: unknown): CaseStepItem[] {
  const parsed = z.array(caseStepItemSchema).safeParse(json);
  return parsed.success ? parsed.data : [];
}

export function parsePlainSteps(json: unknown): PlainStep[] {
  const parsed = z.array(plainStepSchema).safeParse(json);
  return parsed.success ? parsed.data : [];
}

export function parseParams(json: unknown): SharedStepParam[] {
  const parsed = z.array(sharedStepParamSchema).safeParse(json);
  return parsed.success ? parsed.data : [];
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Names of every {{param}} used in a shared step's steps, in first-seen order. */
export function placeholdersIn(steps: PlainStep[]): string[] {
  const seen = new Set<string>();
  for (const s of steps) {
    for (const text of [s.action, s.expected]) {
      for (const m of text.matchAll(PLACEHOLDER)) seen.add(m[1]);
    }
  }
  return [...seen];
}

/** Replace {{param}} with the case's value, falling back to the parameter default. */
export function fillPlaceholders(text: string, params: SharedStepParam[], values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const given = values[name];
    if (given !== undefined && given !== "") return given;
    const def = params.find((p) => p.name === name)?.defaultValue;
    return def !== undefined && def !== "" ? def : whole;
  });
}

export type SharedStepDef = { id: string; name: string; version: number; parameters: SharedStepParam[]; steps: PlainStep[]; /** How many cases use it. */ usedIn?: number };

export type ExpandedStep = PlainStep & {
  number: string;
  /** Set when this step came from a shared step. */
  shared?: { id: string; name: string; version: number };
  /** Test data: which row of the case's table this step belongs to, from 0. */
  row?: number;
  /** Test data: the values filled into this step from its row, shown in blue in the runner. */
  vals?: string[];
  /** Runner only: the case has no steps, so its title stands in as step 1. Never saved to the case. */
  titleOnly?: boolean;
};

/**
 * The steps a tester runs. A case with only a title runs as one step: the
 * title, with "Works as described." as a grey hint under Expected. A lone step
 * with an empty Step box shows the title there. Display only: the case and
 * the run's copy of its steps are not changed.
 */
export function stepsToRun(steps: ExpandedStep[], title: string): ExpandedStep[] {
  if (!steps.length) return [{ number: "1", action: title, expected: "", titleOnly: true }];
  if (steps.length === 1 && !steps[0].shared && !steps[0].action.trim()) return [{ ...steps[0], action: title }];
  // Test data or clients (ver_214): one step per row, its Step box empty, shows the title there too.
  const rows = new Set(steps.map((s) => s.row));
  if (steps.length > 1 && !rows.has(undefined) && rows.size === steps.length && steps.every((s) => !s.shared && !s.action.trim()))
    return steps.map((s) => ({ ...s, action: title, ...(s.expected.trim() ? {} : { titleOnly: true }) }));
  return steps;
}

/** A saved result fits the run's copy of the steps. A case with no steps takes one step result (its title), or none. */
export function stepCountFits(stepCount: number, sent: number) {
  return sent === stepCount || (stepCount === 0 && sent === 1);
}

/**
 * Flatten a case's steps for display or execution. Shared steps expand inline
 * with numbering like 3.1, 3.2; an unknown or deleted shared step becomes a
 * single placeholder step so nothing silently disappears.
 */
export function expandSteps(items: CaseStepItem[], defs: Map<string, SharedStepDef>, columns: string[] = []): ExpandedStep[] {
  const out: ExpandedStep[] = [];
  // Shared step blanks named after a test data column are left for each row to fill.
  const fromRow = (params: SharedStepParam[], given: Record<string, string>) => {
    if (!columns.length) return { params, given };
    const keep = (n: string) => !columns.includes(n);
    return { params: params.filter((p) => keep(p.name)), given: Object.fromEntries(Object.entries(given).filter(([k]) => keep(k))) };
  };
  // Which case item each row came from, to number them once section titles are known.
  const from: number[] = [];
  items.forEach((item, i) => {
    const n = String(i + 1);
    if (item.kind === "step") {
      out.push({ number: n, action: item.action, expected: item.expected });
      from.push(i);
      return;
    }
    const def = defs.get(item.sharedStepId);
    if (!def) {
      out.push({ number: n, action: "[Missing shared step]", expected: "" });
      from.push(i);
      return;
    }
    const { params, given } = fromRow(def.parameters, item.params);
    const shared = { id: def.id, name: fillPlaceholders(def.name, params, given), version: def.version };
    def.steps.forEach((s, j) => {
      out.push({
        number: def.steps.length === 1 ? n : `${n}.${j + 1}`,
        action: fillPlaceholders(s.action, params, given),
        expected: fillPlaceholders(s.expected, params, given),
        shared,
      });
      from.push(i);
    });
  });
  return numberSteps(out, from);
}

/**
 * Number the rows: section titles take no number, so the steps under one count on 1, 2, 3.
 * Rows of one shared step share their number (3.1, 3.2); a one-row shared step that is only a title has none.
 */
function numberSteps(out: ExpandedStep[], from: number[]): ExpandedStep[] {
  const title = out.map((_, k) => isSectionTitle(out, k));
  let n = 0;
  for (let k = 0; k < out.length; ) {
    let end = k;
    while (end + 1 < out.length && from[end + 1] === from[k]) end++;
    const rows = end - k + 1;
    if (rows === 1 && title[k]) out[k].number = "";
    else {
      n++;
      for (let j = k; j <= end; j++) out[j].number = rows === 1 ? String(n) : `${n}.${j - k + 1}`;
    }
    k = end + 1;
  }
  return out;
}

export function sharedStepIdsIn(items: CaseStepItem[]): string[] {
  return [...new Set(items.flatMap((i) => (i.kind === "shared" ? [i.sharedStepId] : [])))];
}

/** Drop blank plain steps the editor leaves behind. */
export function cleanSteps(items: CaseStepItem[]): CaseStepItem[] {
  return items.filter((i) => i.kind === "shared" || i.action.trim() !== "" || i.expected.trim() !== "");
}

/**
 * Steps for a run of a case with test data: the case's steps once per row, with that
 * row's values filled into the {{blanks}}. With no test data, the same as expandSteps.
 */
export function expandForRun(items: CaseStepItem[], defs: Map<string, SharedStepDef>, data: TestData | null): ExpandedStep[] {
  if (!data) return expandSteps(items, defs);
  const base = expandSteps(items, defs, data.columns);
  return data.rows.flatMap((_, r) =>
    base.map((s) => ({
      ...s,
      action: fillRow(s.action, data, r),
      expected: fillRow(s.expected, data, r),
      shared: s.shared && { ...s.shared, name: fillRow(s.shared.name, data, r) },
      row: r,
      vals: valuesUsed(`${s.action}\n${s.expected}`, data, r),
    })),
  );
}

/** "Step 2", or "Row 2, step 2" for a case run with test data. */
export function stepLabel(step: Pick<ExpandedStep, "number" | "row"> | undefined, fallback = ""): string {
  if (!step) return fallback;
  return step.row !== undefined ? `Row ${step.row + 1}, step ${step.number}` : `Step ${step.number}`;
}
