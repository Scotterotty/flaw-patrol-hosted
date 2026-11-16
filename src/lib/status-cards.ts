// Status (ver_228): GitHub, TeamCity, Sentry and CI uploads on one page, under Results.
// Each connected thing is a card: red ones first ("Needs a look"), then "All good", then
// "Can't reach" with who can fix it. Read-only: nothing here changes anything in those tools,
// and cards name builds, never people. This file is the plain logic; src/server/status-checks.ts asks the tools.

export type StatusTool = "GitHub" | "TeamCity" | "Sentry" | "CI uploads";
/** bad: needs a look. good: passed. quiet: nothing to judge yet (no builds, no release). off: can't reach. */
export type StatusState = "bad" | "good" | "quiet" | "off";
/** One past build, oldest to newest on the card. */
export type StatusDot = "pass" | "fail" | "other";

export type StatusSource = { key: string; tool: StatusTool; title: string };

export type StatusCard = StatusSource & {
  state: StatusState;
  /** The short word on the pill: Failed, Passed, New errors, Can't check… */
  pill: string;
  /** One plain sentence. */
  line: string;
  branch?: string;
  /** When the build finished (or the results came in), ISO. */
  at?: string | null;
  /** Extra words before the time, like the RC ("Unity v2.4.2 · RC 23"). */
  label?: string;
  /** The last few builds, oldest first. */
  dots?: StatusDot[];
  /** Straight to that build in the tool. */
  open?: { url: string; label: string };
  /** A page inside Flaw Patrol, like GitHub test health or the run. */
  more?: { href: string; label: string };
  /** Write a bug fills these in (all editable). Only on red cards. */
  bug?: { title: string; build: string; note: string };
  /** Settings row an Admin fixes a can't-reach card in. */
  fix?: string;
  /** The Sentry card's rows, one per build being tested (ver_258). */
  sentry?: SentryBoard;
  checkedAt: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Ends a sentence once: TeamCity's own text may already end with a period. */
const sentence = (s: string) => {
  const t = s.trim();
  return !t ? "" : /[.!?]$/.test(t) ? t : `${t}.`;
};

/** TeamCity's status text, minus anything that names a person ("Canceled by Sam"). */
export function noPeople(text: string): string {
  return text.replace(/[\s(]*\b(?:started|triggered|canceled|cancelled|stopped|requested)\s+by\s+[^;,.)]+\)?/gi, "").trim();
}

export function cantReach(src: StatusSource, message: string, fix: string, checkedAt: string): StatusCard {
  return { ...src, state: "off", pill: "Can't check", line: sentence(message), fix, checkedAt };
}

/** A TeamCity build configuration's card from its newest builds (newest first). */
export function teamcityCard(
  src: StatusSource,
  builds: { number: string; status: string; statusText: string; branch: string; at: string | null; url: string; failedToStart: boolean }[],
  checkedAt: string,
): StatusCard {
  const dots = builds
    .slice(0, 5)
    .reverse()
    .map((b): StatusDot => (b.status === "SUCCESS" ? "pass" : b.status === "FAILURE" || b.status === "ERROR" ? "fail" : "other"));
  const b = builds[0];
  if (!b) return { ...src, state: "quiet", pill: "No builds yet", line: "This build configuration has no finished builds yet.", checkedAt };
  const name = b.number ? `Build ${b.number}` : "The newest build";
  const base = { ...src, branch: b.branch, at: b.at, dots, open: b.url ? { url: b.url, label: "Open in TeamCity" } : undefined, checkedAt };
  if (b.status === "SUCCESS") return { ...base, state: "good", pill: "Passed", line: `${name} passed.` };
  if (b.status === "FAILURE" || b.status === "ERROR") {
    const why = noPeople(b.statusText);
    const line = b.failedToStart ? `${name} failed to start.` : why ? `${name} failed: ${sentence(why)}` : `${name} failed.`;
    return { ...base, state: "bad", pill: "Failed", line, bug: { title: `${src.title.replace(/^TeamCity · /, "")} failed${b.number ? ` (build ${b.number})` : ""}`, build: b.number, note: [line, b.url].filter(Boolean).join("\n") } };
  }
  return { ...base, state: "quiet", pill: "Unknown", line: `TeamCity doesn't say whether ${name.toLowerCase()} passed.` };
}

const GITHUB_FAILED = new Set(["failure", "timed_out", "startup_failure"]);

/** A GitHub workflow's card from its newest runs (newest first). */
export function githubCard(
  src: StatusSource,
  runs: { number: number; branch: string; createdAt: string; status: string; conclusion: string | null; url: string }[],
  why: string | null,
  checkedAt: string,
): StatusCard {
  const done = runs.filter((r) => r.status === "completed");
  const dots = done
    .slice(0, 5)
    .reverse()
    .map((r): StatusDot => (r.conclusion === "success" ? "pass" : GITHUB_FAILED.has(r.conclusion ?? "") ? "fail" : "other"));
  const r = done[0];
  const going = runs[0] && runs[0].status !== "completed" ? " A newer run is going now." : "";
  if (!r) return { ...src, state: "quiet", pill: runs.length ? "Running" : "No runs yet", line: runs.length ? "The first run is going now." : "This workflow hasn't run yet.", checkedAt };
  const base = { ...src, branch: r.branch, at: r.createdAt, dots, open: { url: r.url, label: "Open in GitHub" }, checkedAt };
  if (r.conclusion === "success") return { ...base, state: "good", pill: "Passed", line: `Run ${r.number} passed.${going}` };
  if (GITHUB_FAILED.has(r.conclusion ?? "")) {
    const line = `Run ${r.number} ${r.conclusion === "timed_out" ? "timed out" : "failed"}.${why ? ` ${sentence(why)}` : ""}`;
    return { ...base, state: "bad", pill: "Failed", line: line + going, bug: { title: `${src.title.replace(/^GitHub · /, "")} failed (run ${r.number})`, build: String(r.number), note: [line, r.url].join("\n") } };
  }
  return { ...base, state: "quiet", pill: r.conclusion === "cancelled" ? "Cancelled" : "Skipped", line: `Run ${r.number} was ${r.conclusion === "cancelled" ? "cancelled" : "skipped"}.${going}` };
}

/** One build being tested, as Sentry sees it (ver_258). */
export type SentryBuildIn = {
  build: string;
  /** "Unreal" */
  platform: string;
  /** RC names of the runs testing it ("RC 24"), and "Bug bash" when a live bash is on it. */
  tags: string[];
  /** What Sentry calls the build, or null when Sentry doesn't know it yet. */
  sentryRelease: string | null;
  /** New errors first seen in this build (up to 100), by Sentry issue id. */
  freshIds: string[] | null;
  /** Sentry issue ids already in a bug (saved on failed steps that have a bug). */
  inBugIds: string[];
  /** The new errors themselves, from the same Sentry call as freshIds, for the preview (ver_263). */
  issues?: SentryIssueIn[];
  /** Which bug each filed Sentry issue id is in. */
  bugOf?: Record<string, { key: string; href: string }>;
  crashFree: number | null;
  newUrl: string | null;
  releaseUrl: string | null;
};

/** One new error as Sentry lists it. */
export type SentryIssueIn = { id: string; shortId: string; title: string; culprit: string; url: string; count: number; users: number; lastSeen: string };

/** One error in a build's preview: in a bug (and which one), or not yet. */
export type SentryIssueRow = SentryIssueIn & { bug: { key: string; href: string } | null; filed: boolean };

/** One row on the Sentry card. */
export type SentryRow = {
  build: string;
  platform: string;
  tags: string[];
  sentryRelease: string | null;
  /** bad: new errors not in a bug yet. good: none, or all in bugs. quiet: Sentry doesn't know the build. */
  state: "bad" | "good" | "quiet";
  /** "3 new errors", "No new errors", "Not in Sentry yet" */
  pill: string;
  /** "1 not in a bug yet · 2 already in bugs · 99.4% of sessions had no crash" */
  line: string;
  notInBug: number;
  open?: { url: string; label: string };
  bug?: { title: string; build: string; note: string };
  /** Its new errors, not in a bug first, then most events (up to SENTRY_ISSUES_MAX). */
  issues?: SentryIssueRow[];
  /** How many new errors Sentry has for the build, when more than the preview holds. */
  issueTotal?: number;
};

/** "Other builds" and "No build": errors in the last day outside the tested builds. Null when Sentry can't answer. */
export type SentryElse = { count: number; url: string } | null;

export type SentryBoard = {
  rows: SentryRow[];
  /** Tested builds past the first three. */
  more: number;
  other: SentryElse;
  none: SentryElse;
  /** The newest tested run that has no build, so it's left out. */
  missing: { name: string; href: string; others: number } | null;
};

/** Up to three tested builds on the card; the rest are "and N more". */
export const SENTRY_ROWS = 3;
/** Errors shown per build before "Show all", and the most "Show all" opens on the card (ver_263). */
export const SENTRY_ISSUES = 3;
export const SENTRY_ISSUES_MAX = 20;

/** A build's new errors for the preview: not in a bug yet first, then most events, then newest. */
export function sentryIssueRows(issues: SentryIssueIn[], inBugIds: string[], bugOf: Record<string, { key: string; href: string }> = {}): SentryIssueRow[] {
  const filed = new Set(inBugIds);
  return issues
    .map((i) => ({ ...i, filed: filed.has(i.id), bug: bugOf[i.id] ?? null }))
    .sort((a, b) => Number(a.filed) - Number(b.filed) || b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, SENTRY_ISSUES_MAX);
}

/** Sentry search for errors in releases that aren't being tested. */
export function otherBuildsQuery(releases: string[]) {
  const q = (r: string) => `"${r.replace(/["\\]/g, "\\$&")}"`;
  return releases.length ? `has:release !release:[${releases.map(q).join(",")}]` : "has:release";
}

function sentryRow(b: SentryBuildIn): SentryRow {
  const name = `build ${b.build}`;
  const about = [b.platform, ...b.tags].filter(Boolean).join(" ");
  const base = { build: b.build, platform: b.platform, tags: b.tags, sentryRelease: b.sentryRelease };
  if (!b.sentryRelease) return { ...base, state: "quiet", pill: "Not in Sentry yet", line: `Sentry has no release that matches ${name} yet.`, notInBug: 0 };
  const crash = b.crashFree === null ? "" : `${(b.crashFree * 100).toFixed(1)}% of sessions had no crash`;
  const fresh = b.freshIds ?? [];
  const filed = new Set(b.inBugIds);
  const inBugs = fresh.filter((id) => filed.has(id)).length;
  const notInBug = fresh.length - inBugs;
  if (!fresh.length)
    return { ...base, state: "good", pill: "No new errors", line: crash, notInBug: 0, open: b.releaseUrl ? { url: b.releaseUrl, label: "Open in Sentry" } : undefined };
  const line = [notInBug ? `${notInBug} not in a bug yet` : "", inBugs ? `${inBugs} already in ${inBugs === 1 ? "a bug" : "bugs"}` : "", crash].filter(Boolean).join(" · ");
  const open = b.newUrl ? { url: b.newUrl, label: "Open in Sentry" } : undefined;
  const pill = `${fresh.length >= 100 ? "100+" : fresh.length} new ${fresh.length === 1 ? "error" : "errors"}`;
  const preview = b.issues?.length ? { issues: sentryIssueRows(b.issues, b.inBugIds, b.bugOf), issueTotal: fresh.length } : {};
  if (!notInBug) return { ...base, state: "good", pill, line: `${inBugs === 1 ? "It's" : "All"} already in ${inBugs === 1 ? "a bug" : "bugs"}${crash ? ` · ${crash}` : ""}`, notInBug: 0, open, ...preview };
  const said = `${plural(notInBug, "new Sentry error")} not in a bug yet in ${name}${about ? ` (${about})` : ""}.`;
  return { ...base, state: "bad", pill, line, notInBug, open, ...preview, bug: { title: `New Sentry errors in ${name}${about ? ` (${about})` : ""}`, build: b.build, note: [said, b.newUrl].filter(Boolean).join("\n") } };
}

/**
 * The Sentry card (ver_258), sorted by build: one row per build being tested (results in the last
 * 7 days, or a live bug bash), then errors in the last day from other builds and from no build.
 * Red only for new errors in a tested build that aren't in a bug yet.
 */
export function sentryCard(
  src: StatusSource,
  s: { builds: SentryBuildIn[]; other: SentryElse; none: SentryElse; missing: SentryBoard["missing"] },
  checkedAt: string,
): StatusCard {
  const all = s.builds.map(sentryRow);
  const rows = all.slice(0, SENTRY_ROWS);
  const sentry: SentryBoard = { rows, more: all.length - rows.length, other: s.other, none: s.none, missing: s.missing };
  const base = { ...src, title: "Sentry · by build", sentry, checkedAt };
  const red = all.filter((r) => r.state === "bad");
  if (red.length) {
    const n = red.reduce((t, r) => t + r.notInBug, 0);
    const where = red.length === 1 ? ` in build ${red[0]!.build}` : ` in ${red.length} builds`;
    return { ...base, state: "bad", pill: "New errors", line: `${plural(n, "new error")} not in a bug yet${where}.` };
  }
  if (!all.length)
    return {
      ...base,
      state: "quiet",
      pill: "Nothing being tested",
      line: s.missing ? "The runs being tested have no build yet, so Sentry can't tell which errors are theirs." : "No run has results in the last 7 days, and no bug bash is on.",
    };
  if (all.every((r) => r.state === "quiet")) return { ...base, state: "quiet", pill: "No match", line: "Sentry doesn't know the builds you're testing yet." };
  return { ...base, state: "good", pill: "No new errors", line: all.some((r) => r.pill !== "No new errors" && r.state === "good") ? "New errors in the builds you're testing are all in bugs." : "No new errors in the builds you're testing." };
}

/** CI uploads: the newest results file a pipeline sent, and the ones before it (newest first). */
export function ciCard(src: StatusSource, runs: { title: string; build: string; at: string; href: string; tests: number; failed: number }[], checkedAt: string): StatusCard {
  const r = runs[0];
  if (!r) return { ...src, state: "quiet", pill: "No uploads yet", line: "Nothing has come in from your pipeline yet.", checkedAt };
  const dots = runs
    .slice(0, 5)
    .reverse()
    .map((x): StatusDot => (x.failed ? "fail" : x.tests ? "pass" : "other"));
  const base = { ...src, at: r.at, dots, more: { href: r.href, label: "Open the run" }, checkedAt };
  if (r.failed) {
    const line = `${r.failed} of ${plural(r.tests, "test")} failed in ${r.title}.`;
    return { ...base, state: "bad", pill: "Failed", line, bug: { title: `${r.title}: ${plural(r.failed, "test")} failed`, build: r.build, note: line } };
  }
  return { ...base, state: "good", pill: "Came in", line: r.tests ? `All ${plural(r.tests, "test")} passed in ${r.title}.` : `${r.title} came in with no tests.` };
}

/** Cards in page order: needs a look, all good (passed, then quiet), can't reach. */
export function groupCards(cards: StatusCard[]) {
  return {
    bad: cards.filter((c) => c.state === "bad"),
    good: [...cards.filter((c) => c.state === "good"), ...cards.filter((c) => c.state === "quiet")],
    off: cards.filter((c) => c.state === "off"),
  };
}

/** "2 things need a look", or "All good". */
export function summaryLine(bad: number) {
  return bad ? `${bad} ${bad === 1 ? "thing needs" : "things need"} a look` : "All good";
}

/** Write a bug, with the build and link filled in. Opens the same form as everywhere else. */
export function writeBugHref(groupId: string, bug: NonNullable<StatusCard["bug"]>) {
  const q = new URLSearchParams({ write: "1", title: bug.title, build: bug.build, note: bug.note });
  return `/g/${groupId}/bugs?${q}`;
}
