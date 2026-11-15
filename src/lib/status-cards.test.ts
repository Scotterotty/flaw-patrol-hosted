import { describe, expect, it, vi } from "vitest";
import { ciCard, githubCard, groupCards, noPeople, otherBuildsQuery, sentryCard, sentryIssueRows, summaryLine, teamcityCard, writeBugHref, type SentryBuildIn, type StatusCard } from "./status-cards";
import { parseBuildTypes } from "./teamcity-config";

vi.mock("server-only", () => ({}));
const { teamcityBase, teamcityDate, toBuild } = await import("./teamcity");

const NOW = "2026-11-12T16:00:00.000Z";
const tc = { key: "tc:Shop_NightlyWindows", tool: "TeamCity" as const, title: "TeamCity · Nightly Windows" };
const gh = { key: "gh:r1", tool: "GitHub" as const, title: "GitHub · checkout-web tests" };

const build = (status: string, extra: Partial<Parameters<typeof teamcityCard>[1][number]> = {}) => ({
  number: "812",
  status,
  statusText: "",
  branch: "main",
  at: "2026-11-12T11:02:00.000Z",
  url: "https://tc.example.com/buildConfiguration/Shop_NightlyWindows/812",
  failedToStart: false,
  ...extra,
});

describe("Status cards (ver_228)", () => {
  it("turns a failed TeamCity build into a red card with one plain sentence, the branch and five dots", () => {
    const c = teamcityCard(tc, [build("FAILURE", { statusText: "Tests failed: 14 (2 new), passed: 310" }), build("FAILURE"), build("SUCCESS"), build("SUCCESS"), build("SUCCESS"), build("SUCCESS")], NOW);
    expect(c.state).toBe("bad");
    expect(c.pill).toBe("Failed");
    expect(c.line).toBe("Build 812 failed: Tests failed: 14 (2 new), passed: 310.");
    expect(c.branch).toBe("main");
    // Oldest first, newest on the right.
    expect(c.dots).toEqual(["pass", "pass", "pass", "fail", "fail"]);
    expect(c.open).toEqual({ url: "https://tc.example.com/buildConfiguration/Shop_NightlyWindows/812", label: "Open in TeamCity" });
    expect(c.bug).toEqual({ title: "Nightly Windows failed (build 812)", build: "812", note: `${c.line}\n${c.open!.url}` });
  });

  it("keeps a passed TeamCity build in all good, and a configuration with no builds quiet", () => {
    expect(teamcityCard(tc, [build("SUCCESS")], NOW)).toMatchObject({ state: "good", pill: "Passed", line: "Build 812 passed." });
    expect(teamcityCard(tc, [], NOW)).toMatchObject({ state: "quiet", pill: "No builds yet" });
    expect(teamcityCard(tc, [build("FAILURE", { failedToStart: true })], NOW).line).toBe("Build 812 failed to start.");
  });

  it("never names people, even when TeamCity's text does", () => {
    expect(noPeople("Canceled by Sam Smith")).toBe("");
    expect(noPeople("Exit code 1 (triggered by Pat Lee); tests passed: 4")).toBe("Exit code 1; tests passed: 4");
    expect(noPeople("Tests failed: 1, passed: 9")).toBe("Tests failed: 1, passed: 9");
    expect(teamcityCard(tc, [build("FAILURE", { statusText: "Stopped by Alex" })], NOW).line).toBe("Build 812 failed.");
  });

  it("reads a GitHub workflow's newest finished run, saying when a newer one is going", () => {
    const run = (number: number, conclusion: string | null, status = "completed") => ({ number, branch: "main", createdAt: NOW, status, conclusion, url: `https://github.com/o/r/actions/runs/${number}` });
    const bad = githubCard(gh, [run(9, null, "in_progress"), run(8, "failure"), run(7, "success")], "Some tests failed", NOW);
    expect(bad).toMatchObject({ state: "bad", pill: "Failed", line: "Run 8 failed. Some tests failed. A newer run is going now.", dots: ["pass", "fail"] });
    expect(bad.open?.label).toBe("Open in GitHub");
    expect(githubCard(gh, [run(3, "success")], null, NOW)).toMatchObject({ state: "good", line: "Run 3 passed." });
    expect(githubCard(gh, [run(4, "cancelled")], null, NOW)).toMatchObject({ state: "quiet", pill: "Cancelled" });
    expect(githubCard(gh, [], null, NOW)).toMatchObject({ state: "quiet", pill: "No runs yet" });
  });

  it("previews a build's new errors, not in a bug yet first, then most events (ver_263)", () => {
    const i = (id: string, count: number, lastSeen = "2026-11-14T10:00:00Z") => ({ id, shortId: `OKO-${id}`, title: `Error ${id}`, culprit: "Spawn.Update", url: `https://sentry.io/i/${id}`, count, users: 1, lastSeen });
    const rows = sentryIssueRows([i("1", 5), i("2", 900), i("3", 50), i("4", 50, "2026-11-14T12:00:00Z")], ["2"], { "2": { key: "OKO-4812", href: "/p/OKO/bugs#OKO-4812" } });
    expect(rows.map((r) => r.id)).toEqual(["4", "3", "1", "2"]);
    expect(rows[3]).toMatchObject({ filed: true, bug: { key: "OKO-4812" } });
    expect(rows[0]).toMatchObject({ filed: false, bug: null });
    expect(sentryIssueRows(Array.from({ length: 30 }, (_, n) => i(String(n), n)), [])).toHaveLength(20);

    const src = { key: "sentry", tool: "Sentry" as const, title: "Sentry" };
    const card = sentryCard(
      src,
      { builds: [{ build: "6.4.2", platform: "Unreal", tags: [], sentryRelease: "6.4.2", freshIds: ["1", "2"], issues: [i("1", 5), i("2", 9)], inBugIds: [], crashFree: null, newUrl: "u", releaseUrl: "r" }], other: null, none: null, missing: null },
      NOW,
    );
    expect(card.sentry!.rows[0]).toMatchObject({ issueTotal: 2, issues: [{ id: "2" }, { id: "1" }] });
  });

  it("sorts Sentry errors by build, red only for new errors not in a bug yet (ver_258)", () => {
    const src = { key: "sentry", tool: "Sentry" as const, title: "Sentry" };
    const b = (extra: Partial<SentryBuildIn> = {}): SentryBuildIn => ({
      build: "24.0.1183",
      platform: "Unreal",
      tags: ["RC 24"],
      sentryRelease: "oko-unreal@24.0.1183",
      freshIds: ["1", "2", "3"],
      inBugIds: ["2", "3", "99"],
      crashFree: 0.994,
      newUrl: "https://sentry.io/new",
      releaseUrl: "https://sentry.io/rel",
      ...extra,
    });
    const none = { other: null, none: null, missing: null };
    const red = sentryCard(src, { builds: [b(), b({ build: "2.4.2.88", platform: "Unity", tags: ["RC 23"], freshIds: [] })], ...none }, NOW);
    expect(red).toMatchObject({ title: "Sentry · by build", state: "bad", pill: "New errors", line: "1 new error not in a bug yet in build 24.0.1183." });
    expect(red.sentry!.rows[0]).toMatchObject({ state: "bad", pill: "3 new errors", line: "1 not in a bug yet · 2 already in bugs · 99.4% of sessions had no crash", open: { url: "https://sentry.io/new", label: "Open in Sentry" } });
    expect(red.sentry!.rows[0]!.bug).toEqual({ title: "New Sentry errors in build 24.0.1183 (Unreal RC 24)", build: "24.0.1183", note: "1 new Sentry error not in a bug yet in build 24.0.1183 (Unreal RC 24).\nhttps://sentry.io/new" });
    expect(red.sentry!.rows[1]).toMatchObject({ state: "good", pill: "No new errors", open: { url: "https://sentry.io/rel", label: "Open in Sentry" } });
    expect(red.sentry!.rows[1]!.bug).toBeUndefined();

    // Once they're all filed, the card goes green.
    const filed = sentryCard(src, { builds: [b({ inBugIds: ["1", "2", "3"] })], ...none }, NOW);
    expect(filed).toMatchObject({ state: "good", line: "New errors in the builds you're testing are all in bugs." });
    expect(filed.sentry!.rows[0]).toMatchObject({ state: "good", pill: "3 new errors", line: "All already in bugs · 99.4% of sessions had no crash" });

    // A build Sentry doesn't know is quiet, never red.
    expect(sentryCard(src, { builds: [b({ sentryRelease: null, freshIds: null })], ...none }, NOW)).toMatchObject({ state: "quiet", pill: "No match" });
    expect(sentryCard(src, { builds: [b({ sentryRelease: null, freshIds: null })], ...none }, NOW).sentry!.rows[0]).toMatchObject({ pill: "Not in Sentry yet", line: "Sentry has no release that matches build 24.0.1183 yet." });

    // Up to three rows, then "and N more".
    const many = sentryCard(src, { builds: ["1", "2", "3", "4", "5"].map((n) => b({ build: n, freshIds: [] })), ...none }, NOW);
    expect(many.sentry!.rows.map((r) => r.build)).toEqual(["1", "2", "3"]);
    expect(many.sentry!.more).toBe(2);

    // Nothing being tested: quiet, and says why. The bottom rows and the run with no build still show.
    const missing = { name: "Unreal RC 24 run", href: "/p/OKO/runs/7", others: 0 };
    const quiet = sentryCard(src, { builds: [], other: { count: 7, url: "u1" }, none: { count: 12, url: "u2" }, missing }, NOW);
    expect(quiet).toMatchObject({ state: "quiet", pill: "Nothing being tested", line: "The runs being tested have no build yet, so Sentry can't tell which errors are theirs." });
    expect(quiet.sentry).toMatchObject({ other: { count: 7 }, none: { count: 12 }, missing });
  });

  it("searches Sentry for builds that aren't being tested", () => {
    expect(otherBuildsQuery([])).toBe("has:release");
    expect(otherBuildsQuery(["a@1", 'b"2'])).toBe('has:release !release:["a@1","b\\"2"]');
  });

  it("says when CI results came in, and how many failed", () => {
    const src = { key: "ci", tool: "CI uploads" as const, title: "CI uploads" };
    const r = { title: "Nightly v4.2", build: "4.2", at: NOW, href: "/p/SHOP/runs/4", tests: 20, failed: 0 };
    expect(ciCard(src, [r], NOW)).toMatchObject({ state: "good", pill: "Came in", line: "All 20 tests passed in Nightly v4.2.", more: { href: "/p/SHOP/runs/4", label: "Open the run" } });
    expect(ciCard(src, [{ ...r, failed: 3 }, r], NOW)).toMatchObject({ state: "bad", line: "3 of 20 tests failed in Nightly v4.2.", dots: ["pass", "fail"] });
    expect(ciCard(src, [], NOW)).toMatchObject({ state: "quiet", pill: "No uploads yet" });
  });

  it("orders the page red first, then all good, then can't reach, and counts what needs a look", () => {
    const card = (key: string, state: StatusCard["state"]): StatusCard => ({ key, tool: "GitHub", title: key, state, pill: "", line: "", checkedAt: NOW });
    const g = groupCards([card("a", "off"), card("b", "quiet"), card("c", "good"), card("d", "bad")]);
    expect(g.bad.map((c) => c.key)).toEqual(["d"]);
    expect(g.good.map((c) => c.key)).toEqual(["c", "b"]);
    expect(g.off.map((c) => c.key)).toEqual(["a"]);
    expect(summaryLine(0)).toBe("All good");
    expect(summaryLine(1)).toBe("1 thing needs a look");
    expect(summaryLine(2)).toBe("2 things need a look");
  });

  it("opens the same Write a bug form with the build and link filled in", () => {
    const href = writeBugHref("g1", { title: "Nightly Windows failed (build 812)", build: "812", note: "Build 812 failed.\nhttps://tc/812" });
    const u = new URL(href, "http://x");
    expect(u.pathname).toBe("/g/g1/bugs");
    expect(u.searchParams.get("write")).toBe("1");
    expect(u.searchParams.get("build")).toBe("812");
    expect(u.searchParams.get("note")).toBe("Build 812 failed.\nhttps://tc/812");
  });
});

describe("TeamCity (ver_228)", () => {
  it("tidies the server address someone pastes", () => {
    expect(teamcityBase("teamcity.example.com/")).toBe("https://teamcity.example.com");
    expect(teamcityBase("https://ci.example.com/teamcity/buildConfiguration/Shop_Nightly/812")).toBe("https://ci.example.com/teamcity");
    expect(teamcityBase("http://localhost:8111/favorite/projects")).toBe("http://localhost:8111");
    expect(teamcityBase("not a url at all")).toBe("");
  });

  it("reads TeamCity's dates and builds", () => {
    expect(teamcityDate("20261112T030200+0000")).toBe("2026-11-12T03:02:00.000Z");
    expect(teamcityDate("20261112T030200-0800")).toBe("2026-11-12T11:02:00.000Z");
    expect(teamcityDate("yesterday")).toBeNull();
    expect(toBuild({ id: 1, number: "7", status: "failure", branchName: "refs/heads/main", finishDate: "20261112T030200+0000" })).toMatchObject({ status: "FAILURE", branch: "main", at: "2026-11-12T03:02:00.000Z" });
  });

  it("keeps only well-formed watched builds", () => {
    expect(parseBuildTypes([{ id: "Shop_Nightly", name: "Nightly", project: "Shop" }, { id: "bad id)", name: "x" }, null, "x"])).toEqual([{ id: "Shop_Nightly", name: "Nightly", project: "Shop" }]);
    expect(parseBuildTypes("nope")).toEqual([]);
  });
});
