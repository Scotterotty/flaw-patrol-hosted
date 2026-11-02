// The viewer's time zone. The browser saves it in a cookie (see ZoneCookie), so the
// server can show times on the viewer's own clock: hosting runs in UTC, so a 5:35 PM Pacific
// bug bash used to read 1:35 AM the next day. Without the cookie yet, times fall back to UTC.

export const ZONE_COOKIE = "fp-tz";

/** A real IANA zone name such as "America/Los_Angeles", else "UTC". */
export function cleanZone(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return v;
  } catch {
    return "UTC";
  }
}

/** The calendar day a moment falls on in a zone, as 2026-11-01. */
export function dayIn(d: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A report's date range as the viewer reads it: days typed in the date boxes as typed,
 * and the default "last 30 days" ending today on the viewer's clock, not the server's.
 */
export function rangeDays(from: Date, to: Date, typed: { from?: string; to?: string }, zone: string) {
  const f = typed.from && DAY.test(typed.from) ? typed.from : dayIn(from, zone);
  const t = typed.to && DAY.test(typed.to) ? typed.to : dayIn(to, zone);
  return { from: new Date(`${f}T12:00:00Z`), to: new Date(`${t}T12:00:00Z`) };
}
