import { ENOUGH_EXACT, forgivingFilter } from "./fuzzy";
// How the Projects page sorts projects into sections, so it stays tidy as the
// list grows: Starred, Recent (only once there are enough projects to need it),
// everything else, and Archived and Hidden by you (both collapsed). Search ignores
// sections. Starred and the rest follow the viewer's own dragged order, then name.
// Group cards ride along as items of their own; the projects inside a group only
// show in it (archived and hidden ones still land in those folds).

export type ProjectItem = {
  id: string;
  key: string;
  name: string;
  description: string;
  starred: boolean;
  /** When the viewer last opened it, ms since epoch. */
  visitedAt: number | null;
  archivedAt: number | null;
  /** The viewer's own place for it, from dragging; null sorts by name after the placed ones. */
  position: number | null;
  /** The viewer hid it from their Projects page. */
  hidden: boolean;
  /** Its project group; grouped projects show inside their group's card instead of on their own. */
  groupId?: string | null;
};

/** Below this many active projects one plain grid is easier than sections. */
export const CROWDED = 6;
export const RECENT_COUNT = 3;

export function arrange<T extends ProjectItem>(items: T[]) {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const byPlace = (a: T, b: T) => (a.position ?? Infinity) - (b.position ?? Infinity) || byName(a, b);
  const hidden = items.filter((p) => p.hidden).sort(byName);
  const active = items.filter((p) => p.archivedAt === null && !p.hidden && !p.groupId);
  const starred = active.filter((p) => p.starred).sort(byPlace);
  const recent =
    active.length > CROWDED
      ? active
          .filter((p) => !p.starred && p.visitedAt !== null)
          .sort((a, b) => b.visitedAt! - a.visitedAt!)
          .slice(0, RECENT_COUNT)
      : [];
  const shown = new Set([...starred, ...recent].map((p) => p.id));
  const rest = active.filter((p) => !shown.has(p.id)).sort(byPlace);
  const archived = items.filter((p) => p.archivedAt !== null && !p.hidden).sort((a, b) => b.archivedAt! - a.archivedAt!);
  return { starred, recent, rest, archived, hidden, crowded: active.length > CROWDED };
}

/** Every word of the query appears in the name, key or description. Best matches first: key, then name start. */
export function search<T extends ProjectItem>(items: T[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const score = (p: T) => {
    const key = p.key.toLowerCase();
    const name = p.name.toLowerCase();
    if (key === words.join("")) return 0;
    if (name.startsWith(words[0]) || key.startsWith(words[0])) return 1;
    return 2;
  };
  return items
    .filter((p) => {
      const hay = `${p.name} ${p.key} ${p.description}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || score(a) - score(b) || a.name.localeCompare(b.name));
}

/** A section's ids with one project moved to sit just before another (or at the end when `before` is null). */
export function moveBefore(ids: string[], id: string, before: string | null) {
  if (id === before) return ids;
  const rest = ids.filter((x) => x !== id);
  const at = before === null ? rest.length : rest.indexOf(before);
  return at < 0 ? ids : [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** How the viewer sorts umbrella cards: their own dragged order, latest activity first, or by name. */
export type UmbrellaSort = "mine" | "recent" | "az";
export const UMBRELLA_SORTS: { value: UmbrellaSort; label: string }[] = [
  { value: "mine", label: "My order" },
  { value: "recent", label: "Recently active" },
  { value: "az", label: "A to Z" },
];
export const UMBRELLA_SORT_COOKIE = "fp-umbrella-sort";
/** "all" when the viewer opened every row of Your work on the Umbrellas page. */
export const YOUR_WORK_COOKIE = "fp-your-work";
/** Your work shows this many runs until Show all. */
export const YOUR_WORK_SHORT = 3;
export const parseUmbrellaSort = (v: string | undefined): UmbrellaSort => (v === "recent" || v === "az" ? v : "mine");

export type UmbrellaItem = { id: string; name: string; starred: boolean; position: number | null; /** Latest result, bug, run or case change, ms. */ activity: number | null };

/**
 * Umbrella cards in the viewer's order: starred ones first, then the rest, each
 * sorted the chosen way. In My order an umbrella never placed goes to the bottom.
 */
export function arrangeUmbrellas<T extends UmbrellaItem>(items: T[], sort: UmbrellaSort) {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const by =
    sort === "az"
      ? byName
      : sort === "recent"
        ? (a: T, b: T) => (b.activity ?? -Infinity) - (a.activity ?? -Infinity) || byName(a, b)
        : (a: T, b: T) => (a.position ?? Infinity) - (b.position ?? Infinity) || byName(a, b);
  return [...items.filter((u) => u.starred).sort(by), ...items.filter((u) => !u.starred).sort(by)];
}

/**
 * The whole shown order after moving one umbrella within its own star group
 * (up, down, to the top or bottom of that group, or just before another one).
 */
export function moveUmbrella<T extends UmbrellaItem>(shown: T[], id: string, where: "up" | "down" | "top" | "bottom" | { before: string | null }) {
  const me = shown.find((u) => u.id === id);
  if (!me) return shown.map((u) => u.id);
  const group = shown.filter((u) => u.starred === me.starred).map((u) => u.id);
  const at = group.indexOf(id);
  let ids: string[];
  if (typeof where === "object") ids = moveBefore(group, id, where.before !== null && group.includes(where.before) ? where.before : null);
  else {
    const rest = group.filter((x) => x !== id);
    const to = where === "top" ? 0 : where === "bottom" ? rest.length : where === "up" ? Math.max(0, at - 1) : Math.min(rest.length, at + 1);
    ids = [...rest.slice(0, to), id, ...rest.slice(to)];
  }
  const other = shown.filter((u) => u.starred !== me.starred).map((u) => u.id);
  return me.starred ? [...ids, ...other] : [...other, ...ids];
}

/** One row of the Umbrellas page search: an umbrella, a test cycle in one, or one outside umbrellas. */
export type FindRow = { id: string; kind: "umbrella" | "cycle" | "loose"; name: string; key: string; where: string; href: string; archived: boolean };
export type FindScope = "active" | "archived" | "all";

/** Rows matching every word of the query (name, key or where it lives), live ones first, then by name. */
export function findRows(rows: FindRow[], query: string, scope: FindScope) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows
    .filter((r) => scope === "all" || (scope === "archived") === r.archived)
    .filter((r) => words.every((w) => `${r.name} ${r.key} ${r.where}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** findRows plus close matches spelled a bit differently, for the Umbrellas page search. */
export function findRowsForgiving(rows: FindRow[], query: string, scope: FindScope) {
  const exact = findRows(rows, query, scope);
  const seen = new Set(exact.map((r) => r.id));
  const { close } = forgivingFilter(
    rows.filter((r) => !seen.has(r.id) && (scope === "all" || (scope === "archived") === r.archived)),
    exact.length >= ENOUGH_EXACT ? "" : query,
    (r) => `${r.name} ${r.key} ${r.where}`,
  );
  return { exact, close: exact.length >= ENOUGH_EXACT ? [] : close };
}
