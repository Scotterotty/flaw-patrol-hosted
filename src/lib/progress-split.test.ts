import { describe, expect, it } from "vitest";
import { countStatuses } from "./status";
import { manualLine, splitProgress, type SplitRun } from "./progress-split";

const run = (source: SplitRun["source"], cases: [string, "PASSED" | "FAILED" | "UNTESTED"][]): SplitRun => ({
  source,
  counts: countStatuses(cases.map((c) => c[1])),
  steps: countStatuses([]),
  defects: 0,
  caseStatuses: cases,
});

describe("splitProgress", () => {
  it("never adds manual and automated together, and counts each automated case once by its latest result", () => {
    // Newest first: the latest automated run passed what the older one failed.
    const runs = [
      run("upload", [["a", "PASSED"], ["b", "PASSED"]]),
      run("github", [["a", "FAILED"], ["b", "PASSED"]]),
      run("manual", [["m1", "UNTESTED"], ["m2", "UNTESTED"], ["m3", "UNTESTED"]]),
    ];
    const { manual, auto } = splitProgress(runs);
    expect(manualLine(manual)).toEqual({ tested: 0, total: 3, done: 0 });
    expect(auto.cases).toBe(2);
    expect(auto.latest.PASSED).toBe(2);
    expect(auto.latest.FAILED).toBe(0);
    expect(auto.counts.FAILED).toBe(1);
    expect(auto.runs).toBe(2);
  });
});

describe("in progress", () => {
  it("adds up started cases of manual runs only and keeps the oldest touch", () => {
    const old = new Date("2026-11-01T10:00:00Z");
    const runs: SplitRun[] = [
      { ...run("manual", [["m1", "PASSED"], ["m2", "UNTESTED"]]), inProgress: 1, oldestDraftAt: new Date("2026-11-02T10:00:00Z") },
      { ...run("manual", [["m3", "UNTESTED"], ["m4", "UNTESTED"]]), inProgress: 2, oldestDraftAt: old },
      run("github", [["a", "PASSED"]]),
    ];
    const { manual, auto } = splitProgress(runs);
    expect(manual.inProgress).toBe(3);
    expect(manual.oldestDraftAt).toEqual(old);
    expect(auto.inProgress).toBe(0);
    // In progress never counts as tested.
    expect(manualLine(manual).tested).toBe(1);
  });
});
