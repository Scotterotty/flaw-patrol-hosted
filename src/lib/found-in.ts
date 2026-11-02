// Found-in version (ver_141): the release being tested goes into a Jira version field on new bugs.
// Pure helpers, shared by the server, the bug box and Settings → Jira.

/** Which Jira version field gets the release: Affects versions ("found in") or Fix versions. */
export type FoundInField = "versions" | "fixVersions";
export type FoundInConfig = { field: FoundInField };

export const FOUND_IN_FIELDS: Record<FoundInField, { label: string; hint: string }> = {
  versions: { label: "Affects versions", hint: "found in" },
  fixVersions: { label: "Fix versions", hint: "ship the fix in" },
};

/** The saved setting, or null when it's off. */
export function parseFoundIn(raw: unknown): FoundInConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const field = (raw as { field?: unknown }).field;
  return field === "versions" || field === "fixVersions" ? { field } : null;
}

/** A Jira version, as its project's version list gives it. */
export type JiraVersion = { name: string; released: boolean };

/** "RC 22", "rc22" and "RC-22" are the same version. */
export const versionKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, "");

/** Jira's version with this name, matched loosely, or null. */
export function matchVersion(versions: JiraVersion[], name: string): JiraVersion | null {
  const k = versionKey(name);
  if (!k) return null;
  return versions.find((v) => v.name === name) ?? versions.find((v) => versionKey(v.name) === k) ?? null;
}

/** Where the release came from, for the line under the pick. */
export type FoundInSource = "run" | "bash" | "cycle" | "none";

/** The release a new bug was found in: the run's Release, else the bug bash's, else the test cycle's release name. */
export function foundInRelease(p: { run: string; bash?: string | null; cycle?: string | null }): { name: string; source: FoundInSource } {
  const run = p.run.trim();
  if (run) return { name: run, source: "run" };
  const bash = (p.bash ?? "").trim();
  if (bash) return { name: bash, source: "bash" };
  const cycle = (p.cycle ?? "").trim();
  if (cycle) return { name: cycle, source: "cycle" };
  return { name: "", source: "none" };
}

/** What the bug box shows: the field, the version picked for you and the choices Jira has. */
export type FoundInDraft = {
  field: FoundInField;
  /** The field's name on this Jira's create screen ("Affects versions" unless renamed). */
  label: string;
  /** The release name as Flaw Patrol has it ("" when nothing has one). */
  release: string;
  source: FoundInSource;
  /** Jira's name for the release when it has it, else the release itself (or ""). */
  value: string;
  /** False when the release isn't a version in Jira. */
  known: boolean;
  /** Unreleased versions first (newest first), then released ones. */
  current: string[];
  older: string[];
  /** False when the field isn't on the create screen: the release goes in the description. */
  onScreen: boolean;
};

export function foundInDraft(cfg: FoundInConfig, versions: JiraVersion[], release: { name: string; source: FoundInSource }, screen: { onScreen: boolean; label?: string }): FoundInDraft {
  const match = matchVersion(versions, release.name);
  return {
    field: cfg.field,
    label: screen.label || FOUND_IN_FIELDS[cfg.field].label,
    release: release.name,
    source: release.source,
    value: match?.name ?? release.name,
    known: !!match || !release.name,
    current: versions.filter((v) => !v.released).map((v) => v.name),
    older: versions.filter((v) => v.released).map((v) => v.name),
    onScreen: screen.onScreen,
  };
}

/** The versions shown as quick picks when the release isn't in Jira: the newest unreleased ones. */
export function closestVersions(d: Pick<FoundInDraft, "current" | "older">, n = 2) {
  return [...d.current, ...d.older].slice(0, n);
}

/** The description line when the version can't go in its field. */
export const foundInLine = (label: string, value: string, why: "missing" | "refused") =>
  why === "missing" ? `Found in: ${value} (not a version in Jira, so it isn't in ${label})` : `Found in: ${value} (Jira wouldn't take it in ${label})`;
