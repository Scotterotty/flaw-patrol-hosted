import { describe, expect, it } from "vitest";
import { repoHealth } from "./repo-health";
import { globMatch } from "./github-glob";

const run = (...s: [string, string][]) => ({ entries: s.map(([caseId, status]) => ({ caseId, status })) });

describe("repoHealth", () => {
  it("counts the pass rate across pulled runs and the failing streak", () => {
    const h = repoHealth([run(["a", "PASSED"], ["b", "FAILED"]), run(["a", "PASSED"], ["b", "FAILED"]), run(["a", "PASSED"], ["b", "PASSED"], ["c", "SKIPPED"])]);
    expect(h.passRate).toBe(67);
    expect(h.passed).toBe(4);
    expect(h.total).toBe(6);
    expect(h.trend).toEqual([100, 50, 50]);
    expect(h.failingNow).toEqual([{ caseId: "b", streak: 2 }]);
    expect(h.alwaysFailing).toBe(false);
    expect(h.flaky).toEqual([]);
  });
  it("finds tests that flip between passed and failed", () => {
    const h = repoHealth([run(["a", "PASSED"]), run(["a", "FAILED"]), run(["a", "PASSED"])]);
    expect(h.flaky).toEqual(["a"]);
    expect(h.failingNow).toEqual([]);
  });
  it("handles no pulled runs", () => {
    expect(repoHealth([]).passRate).toBeNull();
  });
});

describe("globMatch", () => {
  it("matches file names in any folder", () => {
    expect(globMatch("*.xml", "junit.xml")).toBe(true);
    expect(globMatch("*.xml", "test-results/junit.xml")).toBe(true);
    expect(globMatch("*.xml", "report.html")).toBe(false);
  });
  it("matches paths and several patterns", () => {
    expect(globMatch("reports/**/*.xml", "reports/a/b/x.xml")).toBe(true);
    expect(globMatch("reports/**/*.xml", "reports/x.xml")).toBe(true);
    expect(globMatch("reports/*.xml", "other/x.xml")).toBe(false);
    expect(globMatch("junit*.xml, TEST-*.xml", "TEST-Cart.xml")).toBe(true);
    expect(globMatch("", "a.xml")).toBe(true);
  });
});
