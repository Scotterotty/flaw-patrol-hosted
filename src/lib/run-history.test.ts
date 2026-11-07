import { describe, expect, it } from "vitest";
import { bugsAcrossSaves, countsInHistory, filesAcrossSaves, isFlaky, latestPerRun, mapHistorySteps, onePerRun } from "./run-history";

describe("run history", () => {
  it("spots flaky cases", () => {
    expect(isFlaky(["FAILED", "PASSED", "FAILED"])).toBe(true);
    expect(isFlaky(["FAILED", "FAILED", "PASSED"])).toBe(false);
  });
  it("maps steps by position, or by text when the case changed", () => {
    expect(mapHistorySteps([{ action: "a" }, { action: "b" }], [{ action: "x" }, { action: "y" }])).toEqual([0, 1]);
    expect(mapHistorySteps([{ action: "a" }, { action: "b" }], [{ action: "b" }, { action: "new" }, { action: "a " }])).toEqual([2, 0]);
    expect(mapHistorySteps([{ action: "gone" }], [{ action: "x" }, { action: "y" }])).toEqual([-1]);
  });
  it("shows each run once, with its latest save (ver_195)", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 6, h));
    const rows = [
      { id: "a1", entryId: "runA", createdAt: at(10), status: "FAILED", defects: [{ defect: { id: "OB-1" } }], attachments: [{ id: "log" }] },
      { id: "b1", entryId: "runB", createdAt: at(11), status: "PASSED", defects: [], attachments: [] },
      { id: "a2", entryId: "runA", createdAt: at(12), status: "PASSED", defects: [{ defect: { id: "OB-2" } }], attachments: [{ id: "log" }] },
    ];
    const groups = onePerRun(rows);
    expect(groups.map((g) => g.latest.id)).toEqual(["a2", "b1"]);
    expect(groups[0].saves.map((s) => s.id)).toEqual(["a2", "a1"]);
    // A bug from the earlier save stays on the run's row; files show once.
    expect(bugsAcrossSaves(groups[0].saves).map((l) => l.defect.id)).toEqual(["OB-2", "OB-1"]);
    expect(filesAcrossSaves(groups[0].saves).map((a) => a.id)).toEqual(["log"]);
    expect(latestPerRun(rows).map((r) => r.id)).toEqual(["a2", "b1"]);
  });
  it("counts a run only once it's closed", () => {
    expect(countsInHistory({ state: "COMPLETED" })).toBe(true);
    expect(countsInHistory({ state: "ACTIVE" })).toBe(false);
  });
});
