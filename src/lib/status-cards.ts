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

/** The Sentry card for the current release candidate. */
export function sentryCard(
  src: StatusSource,
  s: { release: string; label: string; build: string; sentryRelease: string | null; fresh: number | null; crashFree: number | null; newUrl: string | null; releaseUrl: string | null } | null,
  checkedAt: string,
): StatusCard {
  if (!s) return { ...src, state: "quiet", pill: "No release yet", line: "Once a run has a release candidate, this card follows that build in Sentry.", checkedAt };
  const title = `Sentry · ${s.release}`;
  const base = { ...src, title, label: s.label, checkedAt };
  if (!s.sentryRelease)
    return { ...base, state: "quiet", pill: "No match", line: s.build ? `No Sentry release matches build ${s.build} yet.` : "The newest run in this release has no build, so Sentry can't tell which release it is." };
  const crash = s.crashFree === null ? "" : ` ${(s.crashFree * 100).toFixed(1)}% of sessions had no crash.`;
  if (s.fresh && s.fresh > 0) {
    const line = `${plural(s.fresh, "new error")} in this build.${crash}`;
    return { ...base, state: "bad", pill: "New errors", line, open: s.newUrl ? { url: s.newUrl, label: "Open in Sentry" } : undefined, bug: { title: `New Sentry errors in ${s.label}`, build: s.build, note: [line, s.newUrl].filter(Boolean).join("\n") } };
  }
  return { ...base, state: "good", pill: "No new errors", line: `No new errors in this build.${crash}`, open: s.releaseUrl ? { url: s.releaseUrl, label: "Open in Sentry" } : undefined };
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
