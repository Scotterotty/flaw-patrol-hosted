// Forgiving search (ver_96): every search box finds what you typed exactly, then "close
// matches" spelled a bit differently ("wb" finds web, "loign" finds login) under their
// own label. One matcher for every box, so they all behave the same.

export type MatchKind = "exact" | "close";

/** Lower-cased words of a text. "[WEB] Log-in" → ["web", "log", "in"]. */
export const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** What someone typed, minus tag brackets: "[WEB] login" → "web login". */
export const cleanQuery = (q: string) => q.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** Optimal string alignment distance (a swap counts as one slip), stopping early past `max`. */
function slips(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Whether a typed word only ever matches exactly: single letters, numbers and keys like APP-112. */
const exactOnly = (q: string) => q.length < 2 || /\d/.test(q);

/**
 * Whether typed word `q` is a close match for word `w`. Letters may be left out as long as
 * it starts like the word ("wb" → web, never "showbox"); one slip is forgiven for words of
 * 4 to 7 letters and two for longer ones.
 */
export function closeWord(q: string, w: string) {
  if (exactOnly(q) || !w || q[0] !== w[0] && !(q.length >= 4 && q[1] === w[0] && q[0] === w[1])) return false;
  if (w.includes(q)) return true;
  // Skipped letters: every typed letter in order.
  if (q.length >= 2 && q.length < w.length) {
    let i = 0;
    for (const ch of w) if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  const max = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  if (!max) return false;
  // Against the whole word, or its start when it's only partly typed ("regresi" → regression).
  return slips(q, w, max) <= max || (w.length > q.length && slips(q, w.slice(0, q.length), max) <= max);
}

/**
 * How `text` matches `query`: "exact" when it contains what was typed (or every typed word),
 * "close" when every typed word is in it or close to one of its words, else null.
 * `closeText` limits close matches to names, titles, keys, tags and folders, never step text.
 */
export function matchKind(query: string, text: string, closeText = text): MatchKind | null {
  const q = cleanQuery(query);
  if (!q) return "exact";
  const hay = cleanQuery(text);
  const typed = q.split(" ");
  if (hay.includes(q) || typed.every((w) => hay.includes(w))) return "exact";
  const words = wordsOf(closeText);
  const closeHay = cleanQuery(closeText);
  return typed.every((t) => closeHay.includes(t) || words.some((w) => closeWord(t, w))) ? "close" : null;
}

/** Close matches are left out when there are already this many exact ones. */
export const ENOUGH_EXACT = 5;

/**
 * Split a list into exact matches then close ones. `text` is everything searchable; `name`
 * (default the same) is what close matches may look at.
 */
export function forgivingFilter<T>(items: T[], query: string, text: (x: T) => string, name: (x: T) => string = text): { exact: T[]; close: T[] } {
  if (!cleanQuery(query)) return { exact: items, close: [] };
  const exact: T[] = [];
  const close: T[] = [];
  for (const x of items) {
    const k = matchKind(query, text(x), name(x));
    if (k === "exact") exact.push(x);
    else if (k === "close") close.push(x);
  }
  return { exact, close: exact.length >= ENOUGH_EXACT ? [] : close };
}

/** "2 matches · 1 close" for a list's count line. */
export function matchCount(exact: number, close: number) {
  const e = `${exact} ${exact === 1 ? "match" : "matches"}`;
  return close ? `${e} · ${close} close` : e;
}

/** The label above close matches, the same in every search box. */
export const CLOSE_LABEL = "Close matches · spelled a bit differently";

/** Tags (from a case's tags) a search matched, so their pills get an outline. */
export function tagHits(query: string, tags: string[]) {
  const typed = cleanQuery(query).split(" ").filter(Boolean);
  if (!typed.length) return [];
  return tags.filter((t) => {
    const w = t.toLowerCase();
    return typed.some((q) => w === q || closeWord(q, w));
  });
}
