import type { Severity } from "@prisma/client";
import { z } from "zod";

// Bug severities. Flaw Patrol keeps five levels, most severe first; what each is
// called comes from the connected Jira's severity field (ver_91), or a plain
// Critical / Major / Minor / Trivial list when there's no Jira or no such field.

export const SEVERITIES: Severity[] = ["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR", "ENHANCEMENT"];

/** One team's A to E scale, as their Jira spells it: the built-in default before ver_91. */
export const AE_VALUES = ["A - Showstopper", "B - Critical", "C - Problematic", "D - Minor", "E - Enhancement"];

/** Settings → Jira → Severity field (ver_91): the Jira field, its values in order, and which count as critical. */
export type SeverityConfig = { fieldId: string | null; fieldName: string; values: string[]; critical: string[] };

export function parseSeverityConfig(v: unknown): SeverityConfig | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);
  const values = strings(o.values).slice(0, SEVERITIES.length);
  if (!values.length) return null;
  return {
    fieldId: typeof o.fieldId === "string" && o.fieldId ? o.fieldId : null,
    fieldName: typeof o.fieldName === "string" ? o.fieldName : "Severity",
    values,
    critical: strings(o.critical).filter((c) => values.includes(c)),
  };
}

/** What each level is called, which levels the bug box offers, and which count as critical. */
export type SeverityScale = { labels: Record<Severity, string>; levels: Severity[]; critical: Severity[]; fromJira: boolean };

export const PLAIN_SCALE: SeverityScale = {
  labels: { SHOWSTOPPER: "Blocker", CRITICAL: "Critical", PROBLEMATIC: "Major", MINOR: "Minor", ENHANCEMENT: "Trivial" },
  levels: ["CRITICAL", "PROBLEMATIC", "MINOR", "ENHANCEMENT"],
  critical: ["SHOWSTOPPER", "CRITICAL"],
  fromJira: false,
};

/** The scale from a Jira severity field: its values go to the levels in order. */
export function scaleOf(cfg: SeverityConfig | null): SeverityScale {
  if (!cfg) return PLAIN_SCALE;
  const n = cfg.values.length;
  const labels = Object.fromEntries(SEVERITIES.map((s, i) => [s, cfg.values[Math.min(i, n - 1)]])) as Record<Severity, string>;
  const levels = SEVERITIES.slice(0, n);
  return { labels, levels, critical: levels.filter((s) => cfg.critical.includes(labels[s])), fromJira: true };
}

/** The A to E scale, for code and tests that don't know a project. */
export const AE_SCALE = scaleOf({ fieldId: null, fieldName: "Severity", values: AE_VALUES, critical: AE_VALUES.slice(0, 2) });

/** A to E labels by level (the default before ver_91). Prefer a project's scale. */
export const SEVERITY_LABEL: Record<Severity, string> = AE_SCALE.labels;

/** A new bug's starting severity: the middle one. */
export const DEFAULT_SEVERITY: Severity = "PROBLEMATIC";
export const defaultSeverityOf = (scale: SeverityScale): Severity => (scale.levels.includes(DEFAULT_SEVERITY) ? DEFAULT_SEVERITY : scale.levels[Math.floor((scale.levels.length - 1) / 2)]);

/** The label without an "A - " prefix, for counts such as "2 critical bugs". */
export const severityName = (s: Severity, scale: SeverityScale = AE_SCALE) => scale.labels[s].replace(/^[A-Za-z0-9]{1,2}\s*[-–:]\s*/, "");

export const severitySchema = z.enum(["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR", "ENHANCEMENT"]);

export const SEVERITY_TONE = { SHOWSTOPPER: "red", CRITICAL: "red", PROBLEMATIC: "orange", MINOR: "blue", ENHANCEMENT: "gray" } as const;

/** The bugs an end-of-day report calls out: the levels the team counts as critical. */
export const isSevere = (s: Severity, scale: SeverityScale = PLAIN_SCALE) => scale.critical.includes(s);

/**
 * A severity from Jira's option text. The project's own values match first; then
 * "B - Critical", "B", "Critical", and older Flaw Patrol words (Major, Trivial).
 */
export function parseSeverity(text: string | null | undefined, scale?: SeverityScale): Severity | null {
  const v = (text ?? "").trim().toLowerCase();
  if (!v) return null;
  if (scale?.fromJira) {
    const hit = scale.levels.find((s) => scale.labels[s].trim().toLowerCase() === v);
    if (hit) return hit;
  }
  const letter = /^([a-e])\b/.exec(v)?.[1];
  if (letter) return SEVERITIES["abcde".indexOf(letter)];
  if (/showstopper|blocker/.test(v)) return "SHOWSTOPPER";
  if (/critical/.test(v)) return "CRITICAL";
  if (/problematic|major/.test(v)) return "PROBLEMATIC";
  if (/minor/.test(v)) return "MINOR";
  if (/enhancement|trivial/.test(v)) return "ENHANCEMENT";
  return null;
}
