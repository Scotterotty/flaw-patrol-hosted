// Bracket tags (ver_96): "[WEB] - Hub - Space List" becomes the tag Web and the title
// "Hub - Space List". Only leading [X] tokens count; brackets later in a title stay text.

const MAX_TAG = 24;

/**
 * Split leading [brackets] off a title. Several in a row work ("[WEB][UNITY] Sign in"), and
 * a " - ", ":" or "|" right after them is dropped unless `keepDash`. Platform names are
 * matched case-insensitively so [WEB] becomes the platform's own spelling, Web.
 */
export function splitBracketTitle(title: string, opts: { platforms?: string[]; keepDash?: boolean } = {}): { tags: string[]; title: string } {
  const tags: string[] = [];
  let rest = title;
  for (;;) {
    const m = rest.match(/^\s*\[([^\][]{1,40})\]/);
    if (!m) break;
    const word = m[1].trim();
    if (!word || word.length > MAX_TAG) break;
    tags.push(word);
    rest = rest.slice(m[0].length);
  }
  if (!tags.length) return { tags: [], title };
  if (!opts.keepDash) rest = rest.replace(/^\s*(?:[-–—:|]\s*)?/, "");
  rest = rest.trim();
  // A title that was only brackets keeps them as its words.
  if (!rest) return { tags: [], title };
  const platforms = opts.platforms ?? [];
  return { tags: tags.map((t) => platforms.find((p) => p.toLowerCase() === t.toLowerCase()) ?? t), title: rest };
}

/** Whether a title still starts with a bracket tag. */
export const hasBracketTitle = (title: string) => splitBracketTitle(title).tags.length > 0;

/** Colors a tag can take; a tag no one picked a color for gets one from its name. */
export const TAG_COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#db2777", "#0d9488", "#475569", "#65a30d", "#0891b2"];

export function autoTagColor(tag: string) {
  let h = 0;
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

/** Picked colors per tag (lower-cased), stored on the library project. */
export type TagColors = Record<string, string>;

export function parseTagColors(v: unknown): TagColors {
  if (!v || typeof v !== "object") return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && /^#[0-9a-f]{6}$/i.test(e[1])));
}

/** A tag's color: picked, else its platform's, else from its name. */
export function tagColor(tag: string, colors?: TagColors, platformColors?: Record<string, string>) {
  const k = tag.toLowerCase();
  return colors?.[k] ?? platformColors?.[k] ?? autoTagColor(tag);
}

/** "[web]" or "web" in a search box looks for the tag web. */
export const tagQuery = (q: string) => q.trim().replace(/^\[(.*)\]$/, "$1").trim();

/** Jira bug titles put the tags back in front: "[WEB][UNITY] Sign in fails". */
export const withBracketTags = (tags: string[], title: string) => (tags.length ? `${tags.map((t) => `[${t.toUpperCase()}]`).join("")} ${title}` : title);

/** For showing an older snapshot (a run started before the brackets were turned into tags): the clean title and every tag once. */
export function titleWithTags(title: string, tags: string[] = []) {
  const s = splitBracketTitle(title);
  const all = [...tags];
  for (const t of s.tags) if (!all.some((x) => x.toLowerCase() === t.toLowerCase())) all.push(t);
  return { title: s.title, tags: all };
}
