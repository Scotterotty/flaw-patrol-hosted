import type { Severity } from "@prisma/client";
import { z } from "zod";

// Bug bashes (ver_93): a short, timed session where anyone picks an area and logs bugs.
// Client-safe rules and words; the saving lives in src/server/bashes.ts.

export type BashArea = { id: string; name: string; caseId: string; template: string | null };

export function parseAreas(v: unknown): BashArea[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a === "object" && typeof a.id === "string" && typeof a.name === "string")
    .map((a) => ({ id: a.id, name: a.name, caseId: typeof a.caseId === "string" ? a.caseId : "", template: typeof a.template === "string" ? a.template : null }));
}

export const LENGTHS = [30, 60, 90] as const;

export const startSchema = z.object({
  name: z.string().trim().min(1, "Give the bash a name.").max(120),
  minutes: z.number().int().min(10).max(480),
  areas: z
    .array(z.object({ name: z.string().trim().min(1).max(120), template: z.string().max(60).nullable().default(null) }))
    .min(1, "Add at least one area to explore.")
    .max(12, "Up to 12 areas."),
  /** ISO time; empty or in the past means now. */
  startsAt: z.string().max(40).default(""),
  cycleId: z.string().max(40).optional(),
  collectFirst: z.boolean().default(true),
  slack: z.boolean().default(true),
  funExtras: z.boolean().default(false),
});
export type StartInput = z.input<typeof startSchema>;

/** How bad, in a bash's words, and the severity it files as. */
export type BashSeverity = "SHOWSTOPPER" | "CRITICAL" | "PROBLEMATIC" | "MINOR";
export const BASH_SEVERITIES: { id: BashSeverity; label: string; short: string }[] = [
  { id: "MINOR", label: "Low", short: "Low" },
  { id: "PROBLEMATIC", label: "Medium", short: "Med" },
  { id: "CRITICAL", label: "High", short: "High" },
  { id: "SHOWSTOPPER", label: "Blocker", short: "Blocker" },
];
export const sevLabel = (s: Severity) => BASH_SEVERITIES.find((x) => x.id === s)?.short ?? "Med";
export const sevRank = (s: Severity) => ["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR", "ENHANCEMENT"].indexOf(s);

export const ITEM_KINDS = ["bug", "question", "note", "idea"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number] | "covered";

export const logSchema = z.object({
  kind: z.enum(ITEM_KINDS).default("bug"),
  text: z.string().trim().min(1, "Say what you found, in one line.").max(300),
  details: z.string().trim().max(5000).default(""),
  severity: z.enum(["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR"]).default("PROBLEMATIC"),
  attachmentIds: z.array(z.string()).max(10).default([]),
});

export type BashPhase = "scheduled" | "live" | "ended" | "wrapped";

export function phaseOf(b: { startsAt: Date | string; endsAt: Date | string; endedAt: Date | string | null; wrappedAt: Date | string | null }, now = new Date()): BashPhase {
  if (b.wrappedAt) return "wrapped";
  if (b.endedAt || new Date(b.endsAt) <= now) return "ended";
  if (new Date(b.startsAt) > now) return "scheduled";
  return "live";
}

const STOP = new Set("a an the is are was were be to of in on at for and or but it its this that with when then than not no can cant doesnt dont wont isnt page button shows show".split(" "));
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/**
 * Bugs that sound like this one, best first, for "+1, I see it too" (ver_93).
 * Two lines match when most of their words are the same.
 */
export function similarBugs<T extends { text: string }>(text: string, items: T[], min = 0.5) {
  const a = words(text);
  if (a.size < 2) return [];
  return items
    .map((it) => {
      const b = words(it.text);
      let both = 0;
      for (const w of a) if (b.has(w)) both++;
      return { it, score: both / Math.min(a.size, b.size || 1) };
    })
    .filter((x) => x.score >= min && x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.it);
}

export function plusOnesOf(v: unknown): { id: string; name: string }[] {
  return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string").map((p) => ({ id: p.id, name: String(p.name ?? "") })) : [];
}

/** "1:00–2:00 PM" style times for the report. */
export function timeRange(start: Date, end: Date) {
  const t = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${t(start)}–${t(end)}`;
}
