// "Might already cover this" (ver_96): cases whose titles share the words that matter with a
// requirement or a new case's title, so nobody writes the same case twice.

const SKIP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "when", "can", "not", "are", "its", "you", "your", "our", "has", "have", "should", "able", "new", "use", "make", "test", "case", "cases", "check", "verify", "works", "work"]);

/** The words that carry meaning: 3+ letters, not filler, [bracket tags] left out. */
export function keyWords(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !SKIP.has(w))
      // "links" and "link" are the same word here.
      .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );
}

/** Words two titles share. */
export function sharedWords(a: string, b: string) {
  const mine = keyWords(a);
  return [...keyWords(b)].filter((w) => mine.has(w));
}

/**
 * Cases that look like they already test `text`: at least two shared words, and at least half
 * of `text`'s own words when `strict` (a title a person just typed), best first.
 */
export function mightCover<T extends { title: string }>(text: string, cases: T[], opts: { strict?: boolean; limit?: number } = {}) {
  const size = keyWords(text).size;
  return cases
    .map((c) => ({ c, words: sharedWords(text, c.title) }))
    .filter((m) => m.words.length >= 2 && (!opts.strict || m.words.length * 2 >= size))
    .sort((a, b) => b.words.length - a.words.length)
    .slice(0, opts.limit ?? 3);
}
