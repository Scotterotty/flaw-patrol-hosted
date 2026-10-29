import { describe, expect, it } from "vitest";
import { countStatuses, deriveCaseStatus, totals, worst } from "./status";

describe("deriveCaseStatus", () => {
  it("fails the case when any step fails, even if others are untested", () => {
    expect(deriveCaseStatus(["PASSED", "FAILED", "UNTESTED"])).toBe("FAILED");
  });
  it("prefers blocked over retest", () => {
    expect(deriveCaseStatus(["RETEST", "BLOCKED"])).toBe("BLOCKED");
    expect(deriveCaseStatus(["RETEST", "PASSED"])).toBe("RETEST");
  });
  it("passes only when every step is passed or skipped", () => {
    expect(deriveCaseStatus(["PASSED", "SKIPPED"])).toBe("PASSED");
    expect(deriveCaseStatus(["PASSED", "UNTESTED"])).toBe("UNTESTED");
    expect(deriveCaseStatus(["SKIPPED", "SKIPPED"])).toBe("SKIPPED");
    expect(deriveCaseStatus([])).toBe("UNTESTED");
  });
});

describe("counts", () => {
  it("computes progress and pass rate without skipped cases", () => {
    const c = countStatuses(["PASSED", "PASSED", "FAILED", "SKIPPED", "UNTESTED"]);
    expect(totals(c)).toEqual({ total: 5, tested: 4, progress: 0.8, passRate: 2 / 3 });
  });
  it("has no pass rate before anything is tested", () => {
    expect(totals(countStatuses(["UNTESTED"])).passRate).toBeNull();
  });
  it("picks the worst status", () => {
    expect(worst(["PASSED", "RETEST", "BLOCKED"])).toBe("BLOCKED");
  });
});

describe("in progress", () => {
  it("doesn't count as tested", () => {
    const t = totals(countStatuses(["PASSED", "IN_PROGRESS", "UNTESTED"]));
    expect([t.total, t.tested, t.passRate]).toEqual([3, 1, 1]);
  });
});

describe("what counts as run", () => {
  it("counts skipped as run but not retest", () => {
    const t = totals(countStatuses(["PASSED", "SKIPPED", "RETEST", "UNTESTED"]));
    expect([t.total, t.tested, t.passRate]).toEqual([4, 2, 1]);
  });
});
