import { describe, expect, it } from "vitest";
import { capitalize, count, minutesSpent } from "./format";

describe("count", () => {
  it("says 1 result and 2 results", () => {
    expect(count(1, "result")).toBe("1 result");
    expect(count(0, "run")).toBe("0 runs");
    expect(count(3, "case")).toBe("3 cases");
    expect(count(1, "person", "people")).toBe("1 person");
    expect(count(2, "person", "people")).toBe("2 people");
  });
});

describe("minutesSpent", () => {
  it("says under 1 min for a few seconds, not 0 min", () => {
    expect(minutesSpent(3)).toBe("under 1 min");
    expect(capitalize(minutesSpent(59))).toBe("Under 1 min");
  });
  it("keeps whole minutes and hours as before", () => {
    expect(minutesSpent(0)).toBe("0 min");
    expect(minutesSpent(90)).toBe("2 min");
    expect(minutesSpent(3600)).toBe("1 h");
    expect(minutesSpent(3900)).toBe("1 h 5 min");
  });
});
