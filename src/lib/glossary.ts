// Glossary: one shared list of the team's words, each with a plain meaning.
// Anyone can look a word up from selected text; known words get a dotted underline
// wherever they show up. Pure helpers here, used by the page, the underlines and the server.

/** What every page needs to find and explain a term (kept small: it's loaded once per visit). */
export type GlossaryLite = {
  id: string;
  term: string;
  slug: string;
  aliases: string[];
  meaning: string;
};

/** A meaning needs at least this many words before it counts for XP and crowns. */
export const MIN_MEANING_WORDS = 3;
/** Terms that helped: the most XP one term can earn its writer. */
export const HELP_CAP = 10;
export const TERM_MAX = 80;
export const MEANING_MAX = 2000;
export const ALIASES_MAX = 10;

/** Lowercase, single-spaced: "  Repro  Rate" and "repro rate" are the same term. */
export const termKey = (t: string) => t.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** For the term's own link: "Repro rate" → "repro-rate". */
export function slugOf(t: string) {
  const s = termKey(t)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "term";
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** A meaning long enough to count for XP: a few words, not "idk" or "see above". */
export const countsForXp = (meaning: string) => wordCount(meaning) >= MIN_MEANING_WORDS;

/** "org, workspace; tenant" → ["org", "workspace", "tenant"], without the term itself or repeats. */
export function parseAliases(input: string | string[], term = ""): string[] {
  const parts = (Array.isArray(input) ? input : input.split(/[,;\n]/)).map((a) => a.replace(/\s+/g, " ").trim()).filter(Boolean);
  const seen = new Set([termKey(term)]);
  const out: string[] = [];
  for (const a of parts) {
    const k = termKey(a);
    if (seen.has(k) || a.length > TERM_MAX) continue;
    seen.add(k);
    out.push(a);
  }
  return out.slice(0, ALIASES_MAX);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every name a term goes by, longest first so "repro rate" wins over "repro". */
export function namesOf(terms: GlossaryLite[]) {
  const names: { name: string; term: GlossaryLite }[] = [];
  for (const t of terms) {
    if (!t.meaning) continue; // questions nobody answered yet aren't underlined
    for (const n of [t.term, ...t.aliases]) if (termKey(n).length >= 2) names.push({ name: termKey(n), term: t });
  }
  return names.sort((a, b) => b.name.length - a.name.length);
}

/**
 * One regex that finds any known name as a whole word, case-insensitive. Null when the
 * glossary is empty. Word edges are letters and digits, so "RC" matches "RC 22" and "(RC)"
 * but not "source".
 */
export function matcherFor(terms: GlossaryLite[]) {
  const names = namesOf(terms);
  if (!names.length) return null;
  const byName = new Map<string, GlossaryLite>();
  for (const n of names) if (!byName.has(n.name)) byName.set(n.name, n.term);
  const alt = [...byName.keys()].map((n) => escape(n).replace(/ /g, "\\s+")).join("|");
  return { re: new RegExp(`(?<![\\p{L}\\p{N}])(${alt})(?![\\p{L}\\p{N}])`, "giu"), byName };
}

export type TextPart = string | { text: string; term: GlossaryLite };

/**
 * Split text into plain parts and known terms. Each term is marked only the first time it
 * shows up (in this text, or in `seen` when several texts make one card), so a step that
 * says "RC" five times gets one underline.
 */
export function splitTerms(text: string, matcher: ReturnType<typeof matcherFor>, seen: Set<string> = new Set()): TextPart[] {
  if (!matcher || !text) return [text];
  const out: TextPart[] = [];
  let last = 0;
  matcher.re.lastIndex = 0;
  for (let m = matcher.re.exec(text); m; m = matcher.re.exec(text)) {
    const term = matcher.byName.get(termKey(m[1]));
    if (!term || seen.has(term.id)) continue;
    seen.add(term.id);
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ text: m[0], term });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

/** The term a selected word or phrase means, by its name or another name. */
export function findTerm<T extends { term: string; aliases: string[] }>(terms: T[], text: string): T | undefined {
  const k = termKey(text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
  if (!k) return undefined;
  return terms.find((t) => termKey(t.term) === k || t.aliases.some((a) => termKey(a) === k));
}

/** Selected text that's worth offering Look it up for: a word or short phrase, not a paragraph. */
export function lookupText(selected: string) {
  const t = selected.replace(/\s+/g, " ").trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!t || t.length > TERM_MAX || wordCount(t) > 6) return null;
  return t;
}

/** First letter for the A to Z row; anything that isn't A to Z goes under "#". */
export const letterOf = (term: string) => {
  const c = term.normalize("NFKD").charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
};

/**
 * Glossary rights from a person's roles across the app (the Glossary is one list for the
 * whole team): anyone can read and ask; adding and editing follows the "Add and edit
 * Glossary terms" row; deleting someone else's term is for Admins.
 */
export type GlossaryRights = { edit: boolean; deleteAny: boolean };

/** XP-side counts for one person: terms added, questions answered, terms that helped, lookups. */
export type GlossaryWorkRow = { meaning: string; createdById: string | null; answeredById: string | null; createdAt: Date; answeredAt: Date | null; lookups: { userId: string }[] };

export function glossaryStatsFrom(rows: GlossaryWorkRow[], userId: string, since?: Date | null) {
  let added = 0;
  let answered = 0;
  let helped = 0;
  let looked = 0;
  for (const r of rows) {
    if (!countsForXp(r.meaning)) continue;
    const writer = r.answeredById ?? r.createdById;
    if (writer !== userId) continue;
    const at = r.answeredById ? (r.answeredAt ?? r.createdAt) : r.createdAt;
    if (since && at < since) continue;
    if (r.answeredById && r.answeredById !== r.createdById) answered++;
    else added++;
    const others = r.lookups.filter((l) => l.userId !== userId).length;
    looked += others;
    helped += Math.min(HELP_CAP, others);
  }
  return { glossaryTerm: added, glossaryAnswer: answered, glossaryHelp: helped, glossaryLookups: looked };
}
