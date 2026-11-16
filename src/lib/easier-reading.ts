// Easier reading (ver_265): an opt-in reading setting anyone can turn on. More space between
// letters, words and lines, headings and labels in normal capitals instead of ALL CAPS, upright
// text instead of italics, and a softer page in light mode. The CSS is in globals.css
// (:root[data-reading="easier"]); layout.tsx sets the attribute from the account.
//
// A one-time banner on the home and umbrella pages offers it: Try it, Not now (asked once more,
// two weeks later) or × (never again). The answer is kept on the account, so it doesn't come back
// on another computer.

export const READING_ASKS = ["", "later", "done"] as const;
export type ReadingAsk = (typeof READING_ASKS)[number];
export const isReadingAsk = (v: unknown): v is ReadingAsk => READING_ASKS.includes(v as ReadingAsk);

/** How long Not now waits before the banner asks the one last time. */
export const ASK_AGAIN_MS = 14 * 24 * 60 * 60_000;

/** Does this person see the Easier reading banner now? */
export function readingBannerDue(u: { easierReading: boolean; readingAsk: string; readingAskAt: Date | null }, now: Date) {
  if (u.easierReading) return false;
  if (u.readingAsk === "") return true;
  if (u.readingAsk === "later") return !u.readingAskAt || now.getTime() - u.readingAskAt.getTime() >= ASK_AGAIN_MS;
  return false;
}

/** What a banner answer saves: Not now a second time means no, for good. */
export function nextReadingAsk(current: string, answer: "later" | "done"): ReadingAsk {
  return answer === "later" && current !== "later" ? "later" : "done";
}
