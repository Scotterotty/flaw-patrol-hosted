import { describe, expect, it } from "vitest";
import { changeSummary, newsLine, stepChanges } from "./case-news";

const s = (action: string, expected = "", number?: string) => ({ action, expected, number });

describe("stepChanges", () => {
  it("pairs a changed step as reworded and marks added ones new", () => {
    const before = [s("Open cart"), s("Pick the saved card"), s("Tap Pay")];
    const after = [s("Open cart"), s("Pick the saved Visa card ending in 4242"), s("Tap Pay"), s("Open Order history")];
    const r = stepChanges(before, after);
    expect(r.steps).toEqual({ 1: { kind: "reworded", action: "Pick the saved card", expected: "" }, 3: { kind: "new" } });
    expect(r.removed).toBe(0);
    expect(changeSummary(after, r.steps, r.removed, false)).toBe("Step 2 reworded, step 4 added");
  });
  it("counts removed steps and same steps give nothing", () => {
    expect(stepChanges([s("a"), s("b")], [s("a")])).toEqual({ steps: {}, removed: 1 });
    expect(stepChanges([s("a")], [s("a")])).toEqual({ steps: {}, removed: 0 });
  });
  it("uses shared step numbers and notes preconditions", () => {
    const after = [s("x", "", "1.1"), s("y", "", "1.2")];
    expect(changeSummary(after, { 0: { kind: "new" }, 1: { kind: "new" } }, 0, true)).toBe("Steps 1.1, 1.2 added, preconditions updated");
  });
  it("words the heads-up line", () => {
    expect(newsLine({ new: 3, updated: 2 })).toBe("3 new cases and 2 updated");
    expect(newsLine({ new: 1, updated: 0 })).toBe("1 new case");
  });
});
