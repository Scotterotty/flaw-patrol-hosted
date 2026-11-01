/**
 * The corner spinner (ver_116): pure helpers for deciding what counts as "Flaw Patrol is
 * working for you" and what to call it. The component lives in components/busy-corner.tsx.
 */

/** Page moves shorter than this show nothing, so quick clicks don't flicker (Scott, ver_116). */
export const SHOW_AFTER_MS = 333;
/**
 * Things you do on a page (a result, Save, a tick, a filter) only get the thin top line, and
 * sooner, so even quick saves give a hint (ver_130, Scott: keep loading signs out of the way).
 */
export const LINE_AFTER_MS = 150;
/** After this, a page move adds "Still working, hang tight" and a save shows "Still saving, hang tight". */
export const SLOW_AFTER_MS = 10_000;
/** A request this soon after your click, press or key counts as yours. */
export const GESTURE_MS = 1500;
/** A request that starts this soon after one of yours ends (a save, then the page reload) is yours too. */
export const CHAIN_MS = 150;

type HeaderBag = Headers | Record<string, string> | [string, string][] | undefined | null;

function header(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name);
  const want = name.toLowerCase();
  const pairs = Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [k, v] of pairs) if (k.toLowerCase() === want) return String(v);
  return null;
}

/**
 * What kind of request this is: a server action (a save, a start, a delete), a page load
 * (opening or reloading a page), or something else we leave alone (polls, prefetches, files).
 */
export function requestKind(headers: HeaderBag): "action" | "page" | null {
  if (header(headers, "next-action")) return "action";
  if (header(headers, "rsc") === "1" && !header(headers, "next-router-prefetch")) return "page";
  return null;
}

const VERBS: [RegExp, string][] = [
  [/^save\b/i, "Saving…"],
  [/^import\b/i, "Importing…"],
  [/^start\b/i, "Starting…"],
  [/^(delete|remove)\b/i, "Removing…"],
  [/^(add|create|new)\b/i, "Adding…"],
  [/^(send|invite|share)\b/i, "Sending…"],
  [/^(close|finish|end)\b/i, "Closing…"],
  [/^(upload)\b/i, "Uploading…"],
  [/^(export|download)\b/i, "Getting it ready…"],
  [/^(search|find)\b/i, "Searching…"],
];

function clean(text: string | null | undefined) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** "Opening Test runs…" for a link, "Saving…" for a Save button, "Working…" otherwise. */
export function busyLabel(target: { kind: "link" | "button"; text?: string | null } | null): string {
  if (!target) return "Working…";
  // The first line only, without a menu count ("Test cases 12", "Test runs 2 active").
  const first = (target.text ?? "").split("\n").find((l) => l.trim()) ?? "";
  const text = clean(first).replace(/\s+\d+(\s+active)?$/, "");
  if (target.kind === "link") {
    if (!text) return "Opening…";
    const short = text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text;
    return `Opening ${short.replace(/[….]+$/, "")}…`;
  }
  for (const [re, label] of VERBS) if (re.test(text)) return label;
  return "Working…";
}

/** Whether a link click opens another page here (not a new tab, a download, a hash or the same page). */
export function opensHere(
  link: { href: string; target?: string; download?: boolean },
  here: { href: string; origin: string },
  keys: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean; button?: number },
): boolean {
  if (keys.meta || keys.ctrl || keys.shift || keys.alt || (keys.button ?? 0) !== 0) return false;
  if (link.download || (link.target && link.target !== "_self")) return false;
  let to: URL;
  let now: URL;
  try {
    to = new URL(link.href, here.href);
    now = new URL(here.href);
  } catch {
    return false;
  }
  if (to.origin !== here.origin || !/^https?:$/.test(to.protocol)) return false;
  // Only the #part changes: the page just scrolls.
  return to.pathname !== now.pathname || to.search !== now.search;
}

/** Whether a link click moves to another page (the corner spinner), not just a filter or sort on this one (the line only). */
export function movesPage(
  link: { href: string; target?: string; download?: boolean },
  here: { href: string; origin: string },
  keys: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean; button?: number },
): boolean {
  if (!opensHere(link, here, keys)) return false;
  return samePath(link.href, here.href) === false;
}

/** Whether an address (maybe relative) is the page you're on, ignoring ?filters and #parts. null if it can't be read. */
export function samePath(to: string, here: string): boolean | null {
  try {
    const now = new URL(here);
    return new URL(to, now.href).pathname.replace(/\/+$/, "") === now.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Where a save sends you next, from Next.js's x-action-redirect answer ("/p/QA/runs/5;push"). */
export function actionRedirect(value: string | null | undefined): string | null {
  const to = (value ?? "").split(";")[0].trim();
  return to ? to : null;
}
