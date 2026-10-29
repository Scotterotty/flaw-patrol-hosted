import { describe, expect, it } from "vitest";
import { DONE, stateOf, type RcColumn } from "./rc-status";

const col = (o: Partial<RcColumn>): RcColumn => ({
  id: "r", href: "", label: "Unity", runName: "", runIds: ["r"], runs: [], build: "", extra: "", completed: false, total: 39, done: 0, counts: {}, testedAt: [], severities: {}, ...o,
});

describe("RC status label", () => {
  it("is DONE only when every case was run", () => {
    expect(stateOf(col({ done: 39 })).label).toBe("DONE");
    expect(stateOf(col({ done: 39, completed: true })).label).toBe("DONE");
  });
  it("says what was left when a run was closed early", () => {
    expect(stateOf(col({ done: 38, completed: true })).label).toBe("CLOSED · 1 NOT RUN");
  });
  it("is in progress or not started while the run is open", () => {
    expect(stateOf(col({ done: 38 })).label).toBe("IN PROGRESS");
    expect(stateOf(col({ counts: { RETEST: 2 } })).label).toBe("IN PROGRESS");
    expect(stateOf(col({})).label).toBe("NOT STARTED");
  });
  it("counts skipped as run, like the run page", () => {
    expect(DONE).toContain("SKIPPED");
    expect(DONE).not.toContain("RETEST");
  });
});
