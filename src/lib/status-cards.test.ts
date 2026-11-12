import { describe, expect, it, vi } from "vitest";
import { ciCard, githubCard, groupCards, noPeople, sentryCard, summaryLine, teamcityCard, writeBugHref, type StatusCard } from "./status-cards";
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

  it("follows the current release candidate in Sentry", () => {
    const src = { key: "sentry", tool: "Sentry" as const, title: "Sentry" };
    const base = { release: "RC 23", label: "Unity v2.4.2 · RC 23", build: "2.4.2", sentryRelease: "unity@2.4.2", crashFree: 0.981, newUrl: "https://sentry.io/new", releaseUrl: "https://sentry.io/rel" };
    expect(sentryCard(src, { ...base, fresh: 5 }, NOW)).toMatchObject({ title: "Sentry · RC 23", state: "bad", pill: "New errors", line: "5 new errors in this build. 98.1% of sessions had no crash.", label: "Unity v2.4.2 · RC 23" });
    expect(sentryCard(src, { ...base, fresh: 0 }, NOW)).toMatchObject({ state: "good", pill: "No new errors" });
    expect(sentryCard(src, { ...base, fresh: null, sentryRelease: null }, NOW)).toMatchObject({ state: "quiet", line: "No Sentry release matches build 2.4.2 yet." });
    expect(sentryCard(src, null, NOW).state).toBe("quiet");
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
