// Area tags: in "Unity · Spaces Deep Link" or "Unity · Hub - Space List" the word
// after the platform is the part of the app being tested. Words that are already tags
// become tags on their own; new words are offered first (Case library banner, title box,
// import preview). Pure functions, so the browser and the server agree. With no platforms
// set up, a case's single [bracket] tag counts as its platform.

const MAX_AREA = 24;
const SEP = /^\s*[-–—:|]\s*/;

/** Words that start a step-like title ("Verify login…"), never an area. */
export const ACTION_WORDS = new Set(
  "verify check open create sign add delete remove edit test ensure confirm validate update change click tap select go navigate log login logout enter view see make set use start stop close run try send upload download search find save cancel reset turn should can when if the a an".split(" "),
);

/** What a library knows: its platforms, its other tags, and words people said No to. */
export type AreaContext = { platforms: string[]; known: string[]; skip: string[] };

export type AreaCandidate = { word: string; rest: string; known: boolean };

const lower = (s: string) => s.toLowerCase();
const has = (list: string[], w: string) => list.some((x) => lower(x) === lower(w));

/** Whether a word could be an area at all (not an action word, number, platform or skipped word). */
export function areaWordOk(word: string, ctx: AreaContext, tags: string[] = []) {
  const w = word.trim();
  if (!w || w.length > MAX_AREA || !/[a-z]/i.test(w)) return false;
  const words = w.split(/\s+/);
  if (words.length > 2 || ACTION_WORDS.has(lower(words[0]))) return false;
  return !has(ctx.platforms, w) && !has(ctx.skip, w) && !has(tags, w);
}

/**
 * The case follows a platform: one of its tags is a platform name. With no platforms set up
 * (a new umbrella, or a fresh import), a case's only tag, the one from its [bracket], takes
 * the platform's place, so "[WEB] Hub - Downloads" still offers Hub.
 */
export const followsPlatform = (tags: string[], ctx: AreaContext) => (ctx.platforms.length ? tags.some((t) => has(ctx.platforms, t)) : tags.length === 1);

/** The title box: the pill just before the title is the platform (or, with no platforms, the only pill). */
export const pillLeads = (tags: string[], ctx: AreaContext) => (ctx.platforms.length ? tags.length > 0 && has(ctx.platforms, tags[tags.length - 1]) : tags.length === 1);

/**
 * The area word at the start of a title, for a case tagged with a platform. A tag the
 * library already has wins ("Spaces Deep Link"); otherwise one or two words before a dash
 * or colon ("Hub - Space List"). The rest of the title must not be empty.
 */
export function areaCandidate(title: string, tags: string[], ctx: AreaContext): AreaCandidate | null {
  if (!followsPlatform(tags, ctx)) return null;
  const t = title.trim();
  const known = ctx.known.filter((k) => areaWordOk(k, ctx, tags)).sort((a, b) => b.length - a.length);
  for (const k of known) {
    if (lower(t.slice(0, k.length)) !== lower(k)) continue;
    const after = t.slice(k.length);
    if (after && !/^[\s\-–—:|]/.test(after)) continue;
    const rest = after.replace(SEP, "").trim();
    if (rest) return { word: k, rest, known: true };
  }
  const m = t.match(/^([^\s\-–—:|]+(?:\s+[^\s\-–—:|]+)?)\s*[-–—:|]\s*(\S.*)$/);
  if (m && areaWordOk(m[1], ctx, tags)) return { word: m[1], rest: m[2].trim(), known: false };
  return null;
}

export type AreaWord = { word: string; count: number; known: boolean; example: { before: string; after: string; tags: string[] } };

/**
 * Area words across many cases, for the review box and the import preview. Words the
 * library already has as tags count from one case; new words need at least `min` cases,
 * so a one-off word stays in its title.
 */
export function findAreaWords(cases: { title: string; tags: string[] }[], ctx: AreaContext, min = 3): AreaWord[] {
  const found = new Map<string, AreaWord>();
  for (const c of cases) {
    const a = areaCandidate(c.title, c.tags, ctx);
    if (!a) continue;
    const k = lower(a.word);
    const f = found.get(k);
    if (f) f.count++;
    else found.set(k, { word: a.word, count: 1, known: a.known, example: { before: c.title, after: a.rest, tags: [...c.tags, a.word] } });
  }
  return [...found.values()].filter((w) => w.known || w.count >= min).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

/** Move the area word into the tags when it is one of `words`; otherwise leave the case alone. */
export function applyAreaWord(title: string, tags: string[], words: string[], ctx: AreaContext): { title: string; tags: string[] } | null {
  const a = areaCandidate(title, tags, ctx);
  if (!a || !has(words, a.word)) return null;
  const named = words.find((w) => lower(w) === lower(a.word)) ?? a.word;
  return { title: a.rest, tags: [...tags, named] };
}

/**
 * Typing in the title box: a tag the library already has, followed by a space, dash or
 * colon, at the start of the title. The rest may still be empty ("Spaces ").
 */
export function typedKnownArea(text: string, tags: string[], ctx: AreaContext): { word: string; rest: string } | null {
  const known = ctx.known.filter((k) => areaWordOk(k, ctx, tags)).sort((a, b) => b.length - a.length);
  const t = text.replace(/^\s+/, "");
  for (const k of known) {
    if (lower(t.slice(0, k.length)) !== lower(k)) continue;
    const after = t.slice(k.length);
    if (/^[\s\-–—:|]/.test(after)) return { word: k, rest: after.replace(SEP, "").replace(/^\s+/, "") };
  }
  return null;
}
