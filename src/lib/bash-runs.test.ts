import { describe, expect, it } from "vitest";
import { bashRowName, countedRuns } from "./bash-runs";

describe("bug bashes in run reports", () => {
  const runs = [{ id: "a" }, { id: "b", bash: true }, { id: "c", bash: false }];
  it("leaves bug bashes out of the counted runs", () => {
    expect(countedRuns(runs).map((r) => r.id)).toEqual(["a", "c"]);
    expect(countedRuns(runs, "manual").map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("counts them when Runs is set to Bug bash", () => {
    expect(countedRuns(runs, "bash")).toHaveLength(3);
  });
  it("names the row once", () => {
    expect(bashRowName("OKO")).toBe("OKO bug bash");
    expect(bashRowName("Checkout bash")).toBe("Checkout bash");
  });
});
