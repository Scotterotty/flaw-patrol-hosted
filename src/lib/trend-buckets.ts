// Time buckets for report trends: days for a month or less, weeks (from Monday)
// up to about half a year, months beyond. All in UTC, like the rest of reports.

export type BucketUnit = "day" | "week" | "month";

const DAY = 86400_000;

export function unitFor(from: Date, to: Date): BucketUnit {
  const days = (to.getTime() - from.getTime()) / DAY;
  return days <= 31 ? "day" : days <= 190 ? "week" : "month";
}

/** Start of the bucket a moment falls in. */
export function bucketStart(d: Date, unit: BucketUnit): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (unit === "week") t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  if (unit === "month") t.setUTCDate(1);
  return t;
}

export const bucketKey = (d: Date, unit: BucketUnit) => bucketStart(d, unit).toISOString().slice(0, 10);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short axis label: "Oct 20" for days and weeks, "Oct 2026" for months. */
export function bucketLabel(key: string, unit: BucketUnit) {
  const d = new Date(`${key}T00:00:00Z`);
  return unit === "month" ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Every bucket key from one date to another, so empty periods still show. Capped at 400. */
export function bucketKeys(from: Date, to: Date, unit: BucketUnit): string[] {
  const keys: string[] = [];
  const t = bucketStart(from, unit);
  while (t <= to && keys.length < 400) {
    keys.push(t.toISOString().slice(0, 10));
    if (unit === "day") t.setUTCDate(t.getUTCDate() + 1);
    else if (unit === "week") t.setUTCDate(t.getUTCDate() + 7);
    else t.setUTCMonth(t.getUTCMonth() + 1);
  }
  return keys;
}
