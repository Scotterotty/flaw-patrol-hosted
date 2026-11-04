import type { Severity } from "@prisma/client";
import { z } from "zod";
import { releaseKey } from "./rc-status";
import { clockTime, type Spelling } from "./spelling";

// Bug bashes: a short, timed session where anyone picks an area and logs bugs.
// Client-safe rules and words; the saving lives in src/server/bashes.ts.

/**
 * What a bash area (or the whole bash) is testing: a Jira issue, a GitHub PR or any
 * web page. `key` is what shows first: PRJ-12, #418, or a page's name.
 */
export type BashLink = { kind: "jira" | "pr" | "web"; key: string; title: string; url: string; state?: string };
export const LINK_KIND_LABEL: Record<BashLink["kind"], string> = { jira: "Jira", pr: "GitHub PR", web: "Web page" };

export const linkSchema = z.object({
  kind: z.enum(["jira", "pr", "web"]),
  key: z.string().trim().min(1).max(120),
  title: z.string().trim().max(300).default(""),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => u === "" || /^https?:\/\//i.test(u), "Links start with http:// or https://.")
    .default(""),
  state: z.string().trim().max(40).optional(),
});

export function parseLinks(v: unknown): BashLink[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((l) => {
    const r = linkSchema.safeParse(l);
    return r.success ? [r.data] : [];
  });
}

/** `addedAt`: set on an area added after the bash started (ISO time), for its "New" tag. */
export type BashArea = { id: string; name: string; caseId: string; template: string | null; links: BashLink[]; addedAt?: string };

export function parseAreas(v: unknown): BashArea[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a === "object" && typeof a.id === "string" && typeof a.name === "string")
    .map((a) => ({ id: a.id, name: a.name, caseId: typeof a.caseId === "string" ? a.caseId : "", template: typeof a.template === "string" ? a.template : null, links: parseLinks(a.links), ...(typeof a.addedAt === "string" ? { addedAt: a.addedAt } : {}) }));
}

/** How long an area added mid-bash shows its "New" tag. */
export const NEW_AREA_MS = 10 * 60_000;

/** True for an area added while the bash was on, for its first 10 minutes. */
export function isNewArea(a: { addedAt?: string | null }, now = Date.now()) {
  if (!a.addedAt) return false;
  const t = new Date(a.addedAt).getTime();
  return Number.isFinite(t) && now - t < NEW_AREA_MS && now >= t - 60_000;
}

/** + Add area: a name, like the Start box's areas. */
export const areaNameSchema = z.string().trim().min(1, "Type a name for the area.").max(120, "Keep the area name under 120 characters.");

/** A pasted web address as a link: its host and path stand in for a name until someone gives one. */
export function webLink(raw: string, name = ""): BashLink | null {
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    const pr = /^\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(u.pathname);
    if (u.hostname === "github.com" && pr) return { kind: "pr", key: `#${pr[2]}`, title: name || pr[1], url: u.toString() };
    const jira = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/.exec(u.pathname);
    if (jira) return { kind: "jira", key: jira[1], title: name, url: u.toString() };
    const tail = decodeURIComponent(u.pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ");
    const named = name || (tail ? tail[0].toUpperCase() + tail.slice(1) : u.hostname);
    return { kind: "web", key: named.slice(0, 120), title: `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 300), url: u.toString() };
  } catch {
    return null;
  }
}

export const LENGTHS = [30, 60, 90] as const;

export const startSchema = z.object({
  name: z.string().trim().min(1, "Give the bash a name.").max(120),
  minutes: z.number().int().min(10).max(480),
  areas: z
    .array(z.object({ name: z.string().trim().min(1).max(120), template: z.string().max(60).nullable().default(null), links: z.array(linkSchema).max(10).default([]) }))
    .min(1, "Add at least one area to explore.")
    .max(12, "Up to 12 areas."),
  /** ISO time; empty or in the past means now. */
  startsAt: z.string().max(40).default(""),
  cycleId: z.string().max(40).optional(),
  /** The release (RC) it counts toward; empty keeps it on its own (ver_152). */
  release: z.string().trim().max(100).default(""),
  collectFirst: z.boolean().default(true),
  slack: z.boolean().default(true),
  funExtras: z.boolean().default(false),
  /** The bug template bugs use; null is the plain one-line bug. */
  bugTemplateId: z.string().max(40).nullable().default(null),
  /** Platforms people can say they're on when they join; empty means nobody is asked (ver_146). */
  platforms: z.array(z.string()).max(20).default([]),
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

/** What was typed under a template's headings, by heading id. */
export const valuesSchema = z
  .record(z.string().max(40), z.object({ text: z.string().max(20000).default(""), files: z.array(z.object({ id: z.string().max(40), fileName: z.string().max(200) })).max(10).default([]) }))
  .refine((v) => Object.keys(v).length <= 40, "Too many headings.");
/** The person's own automatic table cells: their time (in their zone) and their browser. */
export const seenSchema = z.object({ now: z.string().max(80).default(""), device: z.string().max(120).default("") });
export type Seen = z.input<typeof seenSchema>;

export const logSchema = z.object({
  kind: z.enum(ITEM_KINDS).default("bug"),
  text: z.string().trim().min(1, "Say what you found, in one line.").max(300),
  details: z.string().trim().max(5000).default(""),
  severity: z.enum(["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR"]).default("PROBLEMATIC"),
  attachmentIds: z.array(z.string()).max(10).default([]),
  /** A bug logged with a bug template: which one, and what was typed under its headings. */
  templateId: z.string().max(40).nullable().default(null),
  values: valuesSchema.default({}),
  seen: seenSchema.optional(),
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
 * Bugs that sound like this one, best first, for "+1, I see it too".
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

export function plusOnesOf(v: unknown): { id: string; name: string; platform: string }[] {
  return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string").map((p) => ({ id: p.id, name: String(p.name ?? ""), platform: typeof p.platform === "string" ? p.platform : "" })) : [];
}

// Platforms (ver_146): optional, never required. Anyone joining a bash can say which platform
// they're testing on; each find keeps the one it was logged on, and a +1 keeps where it was seen.

/** A platform name as typed: trimmed, single spaces, at most 40 characters. */
export function cleanPlatform(v: unknown) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 40) : "";
}

/** A list of platform names without blanks or repeats (case doesn't matter), at most 12. */
export function cleanPlatforms(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const p = cleanPlatform(raw);
    if (p && !out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out.slice(0, 12);
}

/** Every platform a bug was seen on: where it was logged first, then each +1's, without repeats. */
export function seenOn(bug: { platform: string; plusOnes: { platform: string }[] }) {
  return cleanPlatforms([bug.platform, ...bug.plusOnes.map((p) => p.platform)]);
}

/**
 * Bugs by platform for the report: a bug seen on two platforms counts on both. Counts bugs,
 * never people. Bugs nobody gave a platform go last as "Didn't say" (platform "").
 */
export function bugsByPlatform(bugs: { platform: string; severity: Severity | string; plusOnes: { platform: string }[] }[], order: string[] = []) {
  const rows = new Map<string, { platform: string; bugs: number; high: number; onlyHere: number; elsewhere: number }>();
  const row = (name: string) => {
    const key = name.toLowerCase();
    if (!rows.has(key)) rows.set(key, { platform: name, bugs: 0, high: 0, onlyHere: 0, elsewhere: 0 });
    return rows.get(key)!;
  };
  for (const name of cleanPlatforms(order)) row(name);
  for (const b of bugs) {
    const on = seenOn(b);
    for (const name of on.length ? on : [""]) {
      const r = row(name);
      r.bugs++;
      if (b.severity === "CRITICAL" || b.severity === "SHOWSTOPPER") r.high++;
      if (on.length > 1) r.elsewhere++;
      else r.onlyHere++;
    }
  }
  const list = [...rows.values()];
  // The bash's own order first, then any typed ones by count, then "Didn't say".
  const rank = (r: { platform: string }) => {
    if (r.platform === "") return 1e6;
    const i = order.findIndex((o) => o.toLowerCase() === r.platform.toLowerCase());
    return i < 0 ? 1000 : i;
  };
  return list.filter((r) => r.bugs > 0 || r.platform !== "").sort((a, b) => rank(a) - rank(b) || b.bugs - a.bugs || a.platform.localeCompare(b.platform));
}

/** "Web 7, Unity 4, Unreal 1" for the summary line, or "" when no bug has a platform. */
export function platformLine(rows: { platform: string; bugs: number }[]) {
  const named = rows.filter((r) => r.platform && r.bugs > 0);
  return named.length ? named.map((r) => `${r.platform} ${r.bugs}`).join(", ") : "";
}

/** "on Web" for the Found in line, or "" when nobody said. */
export const onPlatform = (p: string) => (p ? ` on ${p}` : "");

// Releases (ver_152): a bash can count toward one release, picked by name. It stays on the
// umbrella with every platform it lists; Release status shows it and lists all its bugs.

/** The current releases, newest first, each spelled once ("RC 22" and "rc22" are one). */
export function releaseChoices(names: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    const k = releaseKey(n);
    if (!n || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/** The offered release matching what was asked for, spelled as offered, else "". */
export function matchRelease(want: string, offered: string[]) {
  const k = releaseKey(want.trim());
  return k ? (offered.find((o) => releaseKey(o) === k) ?? "") : "";
}

/** "Its bugs show on the 2.4.0 Release status report, for the platforms this bash lists: Web, iOS." */
export function releaseHint(release: string, platforms: string[]) {
  if (!release) return "Kept on its own. It doesn't show on any release's report.";
  const plats = cleanPlatforms(platforms);
  return `Its bugs show on the ${release} Release status report${plats.length ? `, for the platforms this bash lists: ${plats.join(", ")}` : ""}.`;
}

/** "1:00–2:00 PM" style times for the report. */
export function timeRange(start: Date, end: Date, clock: { spelling?: Spelling; zone?: string } = {}) {
  const t = (d: Date) => clockTime(d, clock.spelling ?? "us", clock.zone);
  return `${t(start)}–${t(end)}`;
}

/** Finds the board lists: every kind but prompts ticked off, without ones merged into another (ver_169). */
export function findCount(items: { kind: string; mergedIntoId?: string | null }[]) {
  return items.filter((i) => i.kind !== "covered" && !i.mergedIntoId).length;
}
