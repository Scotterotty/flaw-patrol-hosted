import { z } from "zod";

/**
 * Arrange menu order (ver_93): each person's own order for the left menu links, saved on
 * User.navOrder. `sections` holds link ids per section ("Library", "Testing"...), and
 * `cycles` the order of the test cycle rows under Test runs, by platform. Empty means the
 * default order. Links stay inside their own section, and Overview is always first.
 */
export const navOrderSchema = z.object({
  sections: z.record(z.string().max(40), z.array(z.string().max(80)).max(40)).default({}),
  cycles: z.array(z.string().max(80)).max(40).default([]),
});
export type NavOrder = z.output<typeof navOrderSchema>;
export const EMPTY_NAV_ORDER: NavOrder = { sections: {}, cycles: [] };

export function parseNavOrder(json: unknown): NavOrder {
  const parsed = navOrderSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : EMPTY_NAV_ORDER;
}

export function isDefaultOrder(o: NavOrder) {
  return !o.cycles.length && Object.values(o.sections).every((l) => !l.length);
}

/**
 * Puts `items` in the saved order without moving the ones the order doesn't know: the
 * spots the known items hold in the default order are refilled with them in saved order,
 * so links that only show up sometimes (or are new in a later build) keep their usual spot.
 */
export function applyOrder<T>(items: T[], idOf: (t: T) => string | undefined, saved: string[]): T[] {
  if (!saved.length) return items;
  const rank = new Map(saved.map((id, n) => [id, n]));
  const known = items.filter((t) => {
    const id = idOf(t);
    return id !== undefined && rank.has(id);
  });
  known.sort((a, b) => rank.get(idOf(a)!)! - rank.get(idOf(b)!)!);
  let k = 0;
  return items.map((t) => {
    const id = idOf(t);
    return id !== undefined && rank.has(id) ? known[k++] : t;
  });
}

/** Moves the entry at `from` to `to` (both indexes into the list). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}
