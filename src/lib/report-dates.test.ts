import { describe, expect, it } from "vitest";
import { datesChanged } from "./report-dates";

describe("datesChanged (Filter count)", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("doesn't count the usual last 30 days the form sends along", () => {
    expect(datesChanged({}, now)).toBe(false);
    expect(datesChanged({ from: "2026-10-07", to: "2026-11-06" }, now)).toBe(false);
  });
  it("counts other dates and All time", () => {
    expect(datesChanged({ from: "2026-10-01", to: "2026-11-06" }, now)).toBe(true);
    expect(datesChanged({ to: "2026-11-01" }, now)).toBe(true);
    expect(datesChanged({ range: "all" }, now)).toBe(true);
  });
  it("ignores dates when a release is picked", () => {
    expect(datesChanged({ release: "1.0", from: "2026-10-01" }, now)).toBe(false);
  });
});
