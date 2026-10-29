import { WHATS_NEW, type WhatsNewEntry, type WhatsNewItem } from "@/content/whats-new";
import type { Spelling } from "./spelling";
import { APP_VERSION } from "./version";

/** This build's number: the last part of the version, 0.3.0-alpha.88 → 88 (matches the download zip). */
export const BUILD = Number(APP_VERSION.split(".").pop()) || 0;

/** The window shows at most this many missed versions; older ones are on the What's new page. */
export const MAX_VERSIONS = 5;

export type Viewer = { role: "all" | "lead" | "admin" | "workspace"; game: boolean; umbrella: string | null };

const RANK = { all: 0, lead: 1, admin: 2, workspace: 3 } as const;

/** One item as this person reads it: hidden when it's for a higher role or a game they don't play. */
function itemFor(i: WhatsNewItem, v: Viewer): WhatsNewItem | null {
  if (RANK[i.who ?? "all"] > RANK[v.role]) return null;
  if (i.game && !v.game) return null;
  if (!i.link?.includes("{umbrella}")) return i;
  return { ...i, link: v.umbrella ? i.link.replace("{umbrella}", v.umbrella) : undefined };
}

/** Every version up to this build, newest first, with only the items this person can use. */
export function entriesFor(v: Viewer, entries: WhatsNewEntry[] = WHATS_NEW, build = BUILD): WhatsNewEntry[] {
  return [...entries]
    .filter((e) => e.version <= build)
    .sort((a, b) => b.version - a.version)
    .map((e) => ({ ...e, items: e.items.map((i) => itemFor(i, v)).filter((i): i is WhatsNewItem => !!i) }))
    .filter((e) => e.items.length > 0);
}

/**
 * What the window shows after sign-in: versions newer than the one this person
 * last closed, newest first, at most MAX_VERSIONS. Never seen (null) shows the
 * newest MAX_VERSIONS. Empty means no window.
 */
export function unseenFor(seen: number | null, v: Viewer, entries: WhatsNewEntry[] = WHATS_NEW, build = BUILD): WhatsNewEntry[] {
  if (seen !== null && seen >= build) return [];
  return entriesFor(v, entries, build)
    .filter((e) => seen === null || e.version > seen)
    .slice(0, MAX_VERSIONS);
}

/** "2026-10-28" → "Oct 28" (UK English: "28 Oct") */
export const shortDate = (iso: string, spelling: Spelling = "us") =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(spelling === "uk" ? "en-GB" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
