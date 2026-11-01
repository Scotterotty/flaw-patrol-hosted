import type { ResultStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildHealth, homeTrends, trendPrefs, withTrendPrefs, type TrendRow } from "./home-trends-calc";
import { keyCandidates } from "./cycle-key";

let n = 0;
function row(over: Partial<Omit<TrendRow, "at">> & { status: ResultStatus; at: string }): TrendRow {
  n++;
  const { at, ...rest } = over;
  return {
    caseId: `c${n}`,
    entryId: `e${n}`,
    runId: "r1",
    release: "",
    runAt: new Date(at),
    automated: false,
    platform: "Unity",
    testerName: "Ana",
    title: "A case",
    caseKey: `OKO-${n}`,
    caseProjectKey: "OKO",
    caseNumber: n,
    archived: false,
    bugs: [],
    ...rest,
    at: new Date(at),
  };
}

describe("homeTrends", () => {
  it("keeps manual and automated pass rates apart, per release in run order", () => {
    const rows = [
      row({ status: "PASSED", at: "2026-10-01T10:00:00Z", release: "RC 1", runId: "a" }),
      row({ status: "FAILED", at: "2026-10-01T11:00:00Z", release: "RC 1", runId: "a" }),
      row({ status: "PASSED", at: "2026-10-01T12:00:00Z", release: "RC 1", runId: "b", automated: true }),
      row({ status: "PASSED", at: "2026-10-08T10:00:00Z", release: "RC 2", runId: "c" }),
    ];
    const t = homeTrends(rows, new Map([["a", 5], ["b", 1], ["c", 3]]), new Date("2026-10-09T00:00:00Z"));
    expect(t.release.map((r) => r.key)).toEqual(["RC 1", "RC 2"]);
    expect(t.release[0]).toMatchObject({ man: 0.5, auto: 1, manCases: 2, autoCases: 1, runs: 2, planned: 5 });
    expect(t.release[1]).toMatchObject({ man: 1, auto: null });
    expect(t.hasManual && t.hasAuto).toBe(true);
  });

  it("counts a case once per run, from its latest result", () => {
    const first = row({ status: "FAILED", at: "2026-10-01T10:00:00Z", release: "RC 1" });
    const again = { ...first, status: "PASSED" as const, at: new Date("2026-10-01T11:00:00Z") };
    const t = homeTrends([first, again], new Map(), new Date("2026-10-02T00:00:00Z"));
    expect(t.release[0]).toMatchObject({ man: 1, manCases: 1 });
  });

  it("fills every week up to now so gaps show, and counts bugs in the week they were found", () => {
    const bug = { id: "d1", at: new Date("2026-10-14T00:00:00Z"), severe: true, open: true };
    const rows = [row({ status: "PASSED", at: "2026-10-06T10:00:00Z" }), row({ status: "FAILED", at: "2026-10-14T10:00:00Z", bugs: [bug] })];
    const t = homeTrends(rows, new Map(), new Date("2026-10-28T00:00:00Z"));
    expect(t.week.map((w) => w.key)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(t.week[1]).toMatchObject({ man: 0, bugs: 1, severe: 1, openBugs: 1 });
    expect(t.week[2]).toMatchObject({ man: null, manCases: 0 });
    expect(t.thisWeek).toBe("2026-10-26");
  });

  it("finds flaky cases (2+ flips in the last 10) and ones that keep failing (3+ in a row)", () => {
    const s = (caseId: string, statuses: ResultStatus[]) =>
      statuses.map((status, i) => row({ caseId, caseKey: caseId, status, runId: `r${i}`, at: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z` }));
    const rows = [...s("FLAKY", ["PASSED", "FAILED", "PASSED", "FAILED"]), ...s("BROKEN", ["PASSED", "FAILED", "FAILED", "FAILED"]), ...s("FINE", ["PASSED", "PASSED"])];
    const t = homeTrends(rows, new Map(), new Date("2026-10-20T00:00:00Z"));
    expect(t.flaky.map((c) => c.caseKey)).toEqual(["FLAKY"]);
    expect(t.flaky[0]).toMatchObject({ count: 3, dots: ["f", "p", "f", "p"] });
    expect(t.failing.map((c) => [c.caseKey, c.count])).toEqual([["BROKEN", 3]]);
  });

  it("leaves archived cases out of the lists", () => {
    const rows = ["PASSED", "FAILED", "PASSED"].map((st, i) => row({ caseId: "x", status: st as ResultStatus, runId: `r${i}`, archived: true, at: `2026-10-0${i + 1}T10:00:00Z` }));
    expect(homeTrends(rows, new Map()).flakyTotal).toBe(0);
  });
});

describe("trend prefs", () => {
  it("defaults to shown with six, and saves only its own words", () => {
    expect(trendPrefs([])).toEqual({ hidden: false, count: 6 });
    const saved = withTrendPrefs(["account:look", "trends:ten"], { hidden: true, count: 20 });
    expect(saved).toEqual(["account:look", "trends:hidden", "trends:twenty"]);
    expect(trendPrefs(saved)).toEqual({ hidden: true, count: 20 });
    expect(trendPrefs(withTrendPrefs(saved, { hidden: false, count: 0 }))).toEqual({ hidden: false, count: 0 });
    expect(withTrendPrefs(saved, { hidden: false, count: 6 })).toEqual(["account:look"]);
  });
});

describe("By build (ver_133)", () => {
  it("makes one bar per automated run, release or not, oldest first", () => {
    const rows = [
      row({ status: "PASSED", at: "2026-11-01T10:00:00Z", runId: "a1", automated: true, runKey: "BH", runNumber: 1, build: "80" }),
      row({ status: "PASSED", at: "2026-11-01T10:00:01Z", runId: "a1", automated: true, runKey: "BH", runNumber: 1, build: "80" }),
      row({ status: "FAILED", at: "2026-11-01T12:00:00Z", runId: "a2", automated: true, runKey: "BH", runNumber: 2, build: "81", release: "RC 1" }),
      row({ status: "PASSED", at: "2026-11-01T12:00:01Z", runId: "a2", automated: true, runKey: "BH", runNumber: 2, build: "81", release: "RC 1" }),
      row({ status: "SKIPPED", at: "2026-11-01T13:00:00Z", runId: "a3", automated: true, runKey: "BH", runNumber: 3 }),
      row({ status: "PASSED", at: "2026-11-01T11:00:00Z", runId: "m1" }),
    ];
    const t = homeTrends(rows, new Map(), new Date("2026-11-02T00:00:00Z"));
    expect(t.build.map((b) => b.label)).toEqual(["80", "81", "Run 3"]);
    expect(t.build[0]).toMatchObject({ passed: 2, failed: 0, rate: 1, href: "/p/BH/runs/1" });
    expect(t.build[1]).toMatchObject({ passed: 1, failed: 1, rate: 0.5 });
    expect(t.build[2]).toMatchObject({ rate: null, other: 1 });
    expect(buildHealth(t.build)).toEqual({ all: 1, failed: 1, none: 1 });
    // Runs with no release still show here, while By release leaves them out.
    expect(t.release.map((r) => r.key)).toEqual(["RC 1"]);
  });
});

describe("keyCandidates (ver_133)", () => {
  it("joins the umbrella key and the name's letters, then numbers", () => {
    expect(keyCandidates("OKO", "Build health").slice(0, 3)).toEqual(["OKOBH", "OKOBH2", "OKOBH3"]);
    expect(keyCandidates("LONGUMBRELL", "Build health")[0]).toBe("LONGUMBREL");
    expect(keyCandidates("LONGUMBRELL", "Build health")[1]).toBe("LONGUMBRE2");
    for (const k of keyCandidates("A", "1")) expect(k).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
  });
});
