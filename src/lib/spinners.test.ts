import { describe, expect, it } from "vitest";
import { cleanSpinners, pickSpinner, SPINNER_FOLD, SPINNERS, spinnerLine } from "./spinners";

describe("loading spinners", () => {
  it("has 14 with unique ids", () => {
    expect(SPINNERS).toHaveLength(14);
    expect(new Set(SPINNERS.map((s) => s.id)).size).toBe(14);
  });
  it("keeps known ones in list order and falls back to the plain ring", () => {
    expect(cleanSpinners(["dice", "nope", "radar"])).toEqual(["radar", "dice"]);
    expect(cleanSpinners([])).toEqual(["ring"]);
    expect(cleanSpinners(null)).toEqual(["ring"]);
  });
  it("picks across the whole list", () => {
    expect(pickSpinner(["radar", "dice"], 0)).toBe("radar");
    expect(pickSpinner(["radar", "dice"], 0.99)).toBe("dice");
    expect(pickSpinner(["radar", "dice"], 1)).toBe("dice");
    expect(pickSpinner(undefined, 0.5)).toBe("ring");
  });
  it("folds to one line that says what you ticked", () => {
    expect(spinnerLine(["ring"])).toBe("Plain ring");
    expect(spinnerLine([])).toBe("Plain ring");
    expect(spinnerLine(["stopwatch", "radar", "bug"])).toBe("3 ticked: Patrol radar, Bug crawl, Stopwatch");
    expect(spinnerLine(SPINNERS.map((s) => s.id))).toMatch(/^14 ticked: Plain ring, /);
  });
  it("saves its open state under an id the account accepts", () => {
    expect(SPINNER_FOLD).toMatch(/^[a-z]+:[a-z-]+$/);
  });
});
