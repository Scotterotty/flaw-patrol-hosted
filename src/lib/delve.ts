import type { Severity } from "@prisma/client";
import { runTitle, versionText } from "./run-label";

// The hidden page's data (public/delve-game/fp-delve.js). Each person only ever gets their own
// save and their own runs and bugs; nothing here is shown to anyone else, and it never writes
// to runs, results or bugs.

/** The most dungeons the picker lists: the newest closed runs first. */
export const MAX_DUNGEONS = 30;
/** Floors named after cases, and bugs named as monsters, per dungeon. */
export const MAX_ROOMS = 12;
export const MAX_BUGS = 40;
/** Paid once per run, the first time its B12 boss falls. The same for every run, whatever its size. */
export const FIRST_CLEAR_BONUS = 30;
/** Saves bigger than this are refused (a full save with a run in progress is about 20 KB). */
export const MAX_SAVE_BYTES = 512 * 1024;

export type DelveBug = { id: string; key: string; title: string; sev: Severity; n: number };
export type Dungeon = { id: string; seed: string; label: string; cases: number; rooms: string[]; bugs: DelveBug[] };

/** "Unity v2.4.2 · RC 23": where it was tested and its version, then the run's name. */
export function dungeonLabel(run: { name: string; build: string; createdAt: Date }, place: string) {
  const v = versionText(run.build);
  return v ? `${[place, v].filter(Boolean).join(" ")} · ${run.name.trim() || "Run"}` : [place, runTitle(run)].filter(Boolean).join(" · ");
}

/** Only the game's own keys, as text, within the size limit; anything else is dropped. */
export function cleanKeys(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (/^delve\.[\w.-]{1,40}$/.test(k) && typeof val === "string") out[k] = val;
  }
  return JSON.stringify(out).length <= MAX_SAVE_BYTES ? out : null;
}
