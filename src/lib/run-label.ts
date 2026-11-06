import { shortDate, type Spelling } from "./spelling";

/**
 * How the app names a run (ver_189): by the version being tested, never "R1".
 * A hotfix build during an RC gets its own version, so its run stands apart.
 * The run number still lives in links (/runs/7) and search still finds "R7".
 */

/** "v2.4.2" for a build that starts with a number, the build as typed otherwise, "" when blank. */
export const versionText = (build?: string | null) => {
  const b = (build ?? "").trim();
  return !b ? "" : /^\d/.test(b) ? `v${b}` : b;
};

export type RunLike = { name?: string | null; build?: string | null; createdAt?: Date | string | null };

/**
 * What tells this run apart: its version, or the day it started when no version was given
 * (left out when the name already says that day, like "Smoke test Nov 6").
 */
export function runTag(r: RunLike, spelling: Spelling = "us", zone?: string): string {
  const v = versionText(r.build);
  if (v) return v;
  if (!r.createdAt) return "";
  const at = new Date(r.createdAt);
  const day = shortDate(at, spelling, zone);
  // Names often carry the day already: "Smoke test Nov 6", or a suite's "Checkout 2026-11-06".
  return r.name && (r.name.includes(day) || r.name.includes(at.toISOString().slice(0, 10))) ? "" : day;
}

/** "Smoke test v2.4.2", or "Smoke test Nov 6" when it has no version. */
export const runTitle = (r: RunLike, spelling: Spelling = "us", zone?: string) => [r.name?.trim() || "Run", runTag(r, spelling, zone)].filter(Boolean).join(" ");
