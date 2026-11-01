import { PAWNS } from "./quest-gear";

// Loading spinners (ver_108): everyone ticks the ones they like in Account → Appearance, and
// the long waits (starting a run, opening a run) play one of them at random. Looks only,
// nothing to unlock. Every one fits the same 48 px circle (src/app/globals.css, .fp-spin).

export const SPINNERS = [
  { id: "ring", label: "Plain ring", help: "The usual" },
  { id: "radar", label: "Patrol radar", help: "A sweep that blips a bug" },
  { id: "magnifier", label: "Magnifying glass", help: "Searching for flaws" },
  { id: "checks", label: "Check march", help: "Three checks tick in turn" },
  { id: "pawn", label: "Pawn hop", help: "Your quest pawn hops along" },
  { id: "bug", label: "Bug crawl", help: "A bug crawls around the circle" },
  { id: "lights", label: "Fail, retest, pass", help: "Lights up Failed, Retest and Passed in turn" },
  { id: "stopwatch", label: "Stopwatch", help: "A ticking second hand" },
  { id: "dice", label: "Lucky roll", help: "A rolling die" },
  { id: "pulse", label: "Field Medic pulse", help: "A beating heart" },
  { id: "ink", label: "Octopus ink", help: "An ink swirl around the octopus" },
  { id: "crown", label: "Spinning crown", help: "A turning crown" },
  { id: "seasonal", label: "Seasonal", help: "Follows the season: a pumpkin at Halloween, a snowman in winter" },
] as const;

export type SpinnerId = (typeof SPINNERS)[number]["id"];
export const DEFAULT_SPINNERS: SpinnerId[] = ["ring"];

/** Pawn hop shows your quest pawn; a picture pawn or none hops as the classic piece. */
export function pawnEmoji(id: string | null | undefined) {
  return PAWNS.find((p) => p.id === id && p.id !== "photo")?.emoji ?? "♟️";
}

export const isSpinner = (id: string): id is SpinnerId => SPINNERS.some((s) => s.id === id);

/** Your ticked spinners, known ones only, in list order; the plain ring when none are left. */
export function cleanSpinners(ids: readonly string[] | null | undefined): SpinnerId[] {
  const set = new Set(ids ?? []);
  const out = SPINNERS.map((s) => s.id).filter((id) => set.has(id));
  return out.length ? out : [...DEFAULT_SPINNERS];
}

/** One of your spinners for this wait; `roll` is a number from 0 up to 1 (Math.random). */
export function pickSpinner(ids: readonly string[] | null | undefined, roll: number): SpinnerId {
  const list = cleanSpinners(ids);
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}

/** The open-state id of the folding Loading spinners section (ver_123), also in Your account's Open all. */
export const SPINNER_FOLD = "acct:spinners";

/** The folded Loading spinners line (ver_123): one name, or "3 ticked: Patrol radar, Bug crawl, Stopwatch". */
export function spinnerLine(ids: readonly string[] | null | undefined) {
  const mine = cleanSpinners(ids);
  const names = SPINNERS.filter((s) => mine.includes(s.id)).map((s) => s.label);
  return names.length === 1 ? names[0] : `${names.length} ticked: ${names.join(", ")}`;
}
