import { describe, expect, it } from "vitest";
import { suiteForCases } from "./suite-match";

describe("suiteForCases", () => {
  const suites = [
    { id: "a", caseIds: ["1", "2", "3"] },
    { id: "b", caseIds: ["4"] },
    { id: "empty", caseIds: [] },
  ];
  it("matches the same cases in any order", () => {
    expect(suiteForCases(suites, ["3", "1", "2"])?.id).toBe("a");
  });
  it("needs exactly the suite's cases", () => {
    expect(suiteForCases(suites, ["1", "2"])).toBeNull();
    expect(suiteForCases(suites, ["1", "2", "3", "4"])).toBeNull();
  });
  it("never matches an empty run or an empty suite", () => {
    expect(suiteForCases(suites, [])).toBeNull();
  });
});
