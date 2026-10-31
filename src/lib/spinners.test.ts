import { describe, expect, it } from "vitest";
import { cleanSpinners, pickSpinner, SPINNERS } from "./spinners";

describe("loading spinners", () => {
  it("has 13 with unique ids", () => {
    expect(SPINNERS).toHaveLength(13);
    expect(new Set(SPINNERS.map((s) => s.id)).size).toBe(13);
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
});
