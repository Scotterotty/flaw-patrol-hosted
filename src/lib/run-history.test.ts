import { describe, expect, it } from "vitest";
import { isFlaky, mapHistorySteps } from "./run-history";

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
});
