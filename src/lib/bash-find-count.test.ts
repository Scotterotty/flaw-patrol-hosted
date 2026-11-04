import { describe, expect, it } from "vitest";
import { findCount } from "./bash";

describe("findCount", () => {
  it("counts every kind the board lists, not ticked prompts or merged finds", () => {
    expect(
      findCount([
        { kind: "bug", mergedIntoId: null },
        { kind: "question" },
        { kind: "note", mergedIntoId: null },
        { kind: "idea" },
        { kind: "covered" },
        { kind: "bug", mergedIntoId: "x" },
      ]),
    ).toBe(4);
  });
  it("is 0 with nothing found", () => expect(findCount([])).toBe(0));
});
