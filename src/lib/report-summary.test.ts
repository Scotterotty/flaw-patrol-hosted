import { describe, expect, it } from "vitest";
import { reportSummary, topFailFolder } from "./report-summary";
import { countStatuses } from "./status";

const run = (state: string, ...s: Parameters<typeof countStatuses>[0]) => ({ state, counts: countStatuses(s) });

describe("reportSummary", () => {
  it("says how it went in one line", () => {
    const s = reportSummary(
      "Oct 1 – 31, 2026",
      [run("COMPLETED", "PASSED", "PASSED", "PASSED", "FAILED"), run("ACTIVE", "PASSED", "BLOCKED", "UNTESTED", "UNTESTED")],
      [{ open: true, severity: "CRITICAL" }, { open: true, severity: "MINOR" }, { open: false, severity: "CRITICAL" }],
      "Checkout",
    );
    expect(s.line).toBe("Oct 1 – 31, 2026: 2 runs, 67% passed. 2 open bugs, 1 critical. 1 case blocked. Most failures are in Checkout.");
    expect(s).toMatchObject({ runs: 2, openBugs: 2, critical: 1, blocked: 1, notRun: 2 });
  });
  it("counts not run yet only in open runs", () => {
    expect(reportSummary("All time", [run("COMPLETED", "UNTESTED"), run("ACTIVE", "RETEST", "IN_PROGRESS")], []).notRun).toBe(2);
  });
  it("leaves out what is zero", () => {
    expect(reportSummary("Release 2.1", [run("COMPLETED", "PASSED")], []).line).toBe("Release 2.1: 1 run, 100% passed. No open bugs.");
  });
  it("says when there are no runs", () => {
    expect(reportSummary("Oct 1 – 31, 2026", [], []).line).toBe("No runs from Oct 1 – 31, 2026.");
    expect(reportSummary("Release 2.1", [], []).line).toBe("No runs in Release 2.1.");
    expect(reportSummary("All time", [], []).line).toBe("No runs yet.");
  });
});

describe("topFailFolder", () => {
  it("picks the folder with the most failures", () => {
    expect(topFailFolder(["Login", "Checkout", null, "Checkout"])).toBe("Checkout");
    expect(topFailFolder([null])).toBeNull();
    expect(topFailFolder(["B", "A"])).toBe("A");
  });
});
