// Configurations and test plans (Liam's request, TestRail style). Pure helpers, shared by the
// server, Create a run, the plan page and the runner.
//
// A Configuration is a named set of values in an umbrella, like Platforms (Windows, Mac,
// Quest 3). Ticking values in Create a run makes one test plan holding one normal run per
// value, or one per pairing when values from two Configurations are ticked.

import { z } from "zod";

export type Configuration = { id: string; name: string; values: string[] };
/** One run's values inside a plan, in the plan's Configuration order. */
export type PlanValue = { name: string; value: string };
/** A plan's Configurations, copied when it was made. */
export type PlanConfig = { name: string; values: string[] };

export const MAX_CONFIGURATIONS = 12;
export const MAX_VALUES = 100;
export const MAX_VALUE_LENGTH = 120;
/** The most runs one plan can hold, so two big Configurations can't make hundreds by accident. */
export const MAX_PLAN_RUNS = 50;

const configSchema = z.object({
  id: z.string().max(40),
  name: z.string().max(60),
  values: z.array(z.string().max(MAX_VALUE_LENGTH)).max(MAX_VALUES),
});

/** The umbrella's saved Configurations; anything unreadable is left out. */
export function parseConfigurations(raw: unknown): Configuration[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    const r = configSchema.safeParse(c);
    return r.success && r.data.name.trim() ? [{ id: r.data.id, name: r.data.name.trim(), values: r.data.values }] : [];
  });
}

export function parsePlanValues(raw: unknown): PlanValue[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v) => (v && typeof v === "object" && typeof (v as PlanValue).name === "string" && typeof (v as PlanValue).value === "string" ? [{ name: (v as PlanValue).name, value: (v as PlanValue).value }] : []));
}

export function parsePlanConfigs(raw: unknown): PlanConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) =>
    c && typeof c === "object" && typeof (c as PlanConfig).name === "string" && Array.isArray((c as PlanConfig).values)
      ? [{ name: (c as PlanConfig).name, values: (c as PlanConfig).values.filter((v): v is string => typeof v === "string") }]
      : [],
  );
}

/**
 * Values typed or pasted from a sheet: one per line (tabs or a header-less column work too),
 * trimmed, blanks and repeats dropped. Case differences count as repeats.
 */
export function valuesFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n|\t/)) {
    const v = line.trim().replace(/\s+/g, " ").slice(0, MAX_VALUE_LENGTH);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

/**
 * Every pairing of the ticked values, in order: Songs [A, B] × Platforms [Mac, PC] gives
 * A·Mac, A·PC, B·Mac, B·PC. Configurations with nothing ticked are skipped.
 */
export function pairings(picks: PlanConfig[]): PlanValue[][] {
  const used = picks.filter((p) => p.values.length);
  if (!used.length) return [];
  return used.reduce<PlanValue[][]>((acc, p) => acc.flatMap((combo) => p.values.map((value) => [...combo, { name: p.name, value }])), [[]]);
}

/** How many runs the ticks make, before anything is made. */
export function pairingCount(picks: PlanConfig[]): number {
  const used = picks.filter((p) => p.values.length);
  return used.length ? used.reduce((n, p) => n * p.values.length, 1) : 0;
}

/** "Neverender · Quest 3": a plan run's values, as its name ends and the plan page shows it. */
export function valuesLabel(values: PlanValue[]): string {
  return values.map((v) => v.value).join(" · ");
}

/** A plan run's name: the plan's name, then its values. */
export function planRunName(planName: string, values: PlanValue[]): string {
  return `${planName} · ${valuesLabel(values)}`.slice(0, 200);
}

/** "This makes 1 test plan with 9 runs (3 cases each, 27 to test)." */
export function planCountLine(runs: number, cases: number, plans = 1): string {
  const each = cases ? ` (${cases === 1 ? "1 case" : `${cases} cases`} each, ${runs * cases * plans} to test)` : "";
  const planWord = plans === 1 ? "1 test plan" : `a test plan in each of ${plans} test cycles`;
  return `This makes ${planWord} with ${runs === 1 ? "1 run" : `${runs} runs`}${each}.`;
}

/**
 * The {{blank}} names a Configuration fills: its name and its singular, any case,
 * spaces as underscores. "Songs" fills {{Songs}}, {{songs}} and {{song}}.
 */
export function blankNames(configName: string): string[] {
  const base = configName.trim().toLowerCase().replace(/[^a-z0-9_ ]/g, "").replace(/\s+/g, "_");
  if (!base) return [];
  const names = new Set([base, base.replace(/_/g, "")]);
  for (const n of [...names]) {
    if (n.endsWith("ies") && n.length > 4) names.add(`${n.slice(0, -3)}y`);
    else if (/(s|x|ch|sh)es$/.test(n) && n.length > 4) names.add(n.slice(0, -2));
    else if (n.endsWith("s") && !n.endsWith("ss") && n.length > 2) names.add(n.slice(0, -1));
  }
  return [...names];
}

const BLANK = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Fill a plan run's values into {{blanks}} named after their Configuration. Other blanks stay. */
export function fillPlanBlanks(text: string, values: PlanValue[]): { text: string; used: string[] } {
  if (!values.length || !text.includes("{{")) return { text, used: [] };
  const byName = new Map<string, string>();
  for (const v of values) for (const n of blankNames(v.name)) if (!byName.has(n)) byName.set(n, v.value);
  const used: string[] = [];
  const out = text.replace(BLANK, (whole, name: string) => {
    const v = byName.get(name.toLowerCase());
    if (v === undefined) return whole;
    if (!used.includes(v)) used.push(v);
    return v;
  });
  return { text: out, used };
}

/** "{{platform}}": the blank to show in Settings for a Configuration. */
export function blankHint(configName: string): string {
  const names = blankNames(configName);
  return names.length ? `{{${names[names.length - 1]}}}` : "";
}

export type PlanCounts = { passed: number; failed: number; notRun: number; total: number; tested: number };

/** A plan's (or one run's) summary from its cases' statuses. Not run = untested, retest or in progress. */
export function planCounts(statuses: string[]): PlanCounts {
  let passed = 0;
  let failed = 0;
  let notRun = 0;
  for (const s of statuses) {
    if (s === "PASSED") passed++;
    else if (s === "FAILED") failed++;
    else if (s === "UNTESTED" || s === "RETEST" || s === "IN_PROGRESS") notRun++;
  }
  return { passed, failed, notRun, total: statuses.length, tested: statuses.length - notRun };
}

/** Whole-number percent passed, out of every case in it: "48%". */
export function passedPct(c: Pick<PlanCounts, "passed" | "total">): string {
  return c.total ? `${Math.round((c.passed / c.total) * 100)}%` : "–";
}

/** Share runs across testers in turn: run 1 to the first, run 2 to the second… */
export function splitEvenly<T>(runIds: T[], people: string[]): Map<T, string> {
  const out = new Map<T, string>();
  if (!people.length) return out;
  runIds.forEach((id, i) => out.set(id, people[i % people.length]));
  return out;
}

/** A short id for a new Configuration, unlike the ones already there. */
export function configId(name: string, taken: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "config";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}
