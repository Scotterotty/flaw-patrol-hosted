// Requirements page and Risk board filters (ver_161): one or more Jira releases, and one requirement project.
// In the address: ?release=2.4&release=Web%202.4&proj=MOB, or release=any (Requirements page only).

/** The releases picked in the address: those Jira lists, in the order picked. "any" = every release. */
export function pickedReleases(param: string | string[] | undefined, releases: string[]): string[] | "any" | null {
  const raw = (Array.isArray(param) ? param : param ? [param] : []).filter(Boolean);
  if (raw.includes("any")) return "any";
  const ok = [...new Set(raw.filter((r) => releases.includes(r)))];
  return ok.length ? ok : null;
}

/** The project picked in the address, when it's one of the requirement projects. */
export function pickedProject(param: string | string[] | undefined, keys: string[] | null) {
  const p = (Array.isArray(param) ? param[0] : param)?.toUpperCase();
  return p && keys && keys.length > 1 && keys.includes(p) ? p : null;
}

/** The project part of a Jira key: "MOB" for MOB-88. */
export const projectOfKey = (key: string) => key.split("-")[0]?.toUpperCase() ?? "";

/** The query string for these picks, for links between the two pages. */
export function reqQuery(picks: { releases?: string[] | "any" | null; proj?: string | null }, extra: Record<string, string | undefined> = {}) {
  const u = new URLSearchParams();
  if (picks.releases === "any") u.append("release", "any");
  else for (const r of picks.releases ?? []) u.append("release", r);
  if (picks.proj) u.set("proj", picks.proj);
  for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v);
  return u.size ? `?${u}` : "";
}

/** "2.4", "2.4 + Web 2.4". */
export const releaseLabel = (releases: string[]) => releases.join(" + ");
