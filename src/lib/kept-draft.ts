// Keep what you're typing (Scott, Nov 13 2026: "I hate writing a bug and all of a sudden I
// accidentally refresh the page"). Every form that takes real writing copies itself into this
// browser as you type, filed under your sign-in and the form's place, so a refresh, a closed tab,
// Esc or a click away never loses it. Saving the form, Start fresh, or 7 days clear it.

export const KEPT_PREFIX = "fp-kept:";
export const KEPT_DAYS = 7;
const MAX_AGE = KEPT_DAYS * 24 * 60 * 60 * 1000;

/** What one kept draft looks like in storage. */
export type Kept<T = unknown> = { at: number; data: T };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** The storage key for one person's draft in one place, e.g. "fp-kept:u1:write-bug". */
export const keptKey = (owner: string, place: string) => `${KEPT_PREFIX}${owner}:${place}`;

/** The draft kept here, or null when there's none, it's unreadable, or it's past 7 days (then it's removed). */
export function readKept<T>(store: Store, key: string, now: number): Kept<T> | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const got = JSON.parse(raw) as Kept<T>;
    if (typeof got?.at !== "number" || !("data" in got) || now - got.at > MAX_AGE) {
      store.removeItem(key);
      return null;
    }
    return got;
  } catch {
    return null;
  }
}

/** Keeps a draft; false when the browser won't (private window, storage full or blocked). */
export function writeKept(store: Store, key: string, data: unknown, now: number): boolean {
  try {
    store.setItem(key, JSON.stringify({ at: now, data } satisfies Kept));
    return true;
  } catch {
    return false;
  }
}

export function dropKept(store: Store, key: string) {
  try {
    store.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept anyway.
  }
}

/** Clears every kept draft (anyone's) older than 7 days. */
export function sweepKept(store: Store, now: number) {
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(KEPT_PREFIX)) keys.push(k);
    }
    for (const k of keys) readKept(store, k, now);
  } catch {
    // Storage blocked.
  }
}

/** Whether a kept draft is worth bringing back: something in it differs from the empty form. */
export const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

/**
 * A short stamp of what a form opened with, for its place name: once someone saves a newer
 * version, the stamp changes and an older draft isn't offered on top of it.
 */
export function keptStamp(v: unknown): string {
  const s = JSON.stringify(v) ?? "";
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
