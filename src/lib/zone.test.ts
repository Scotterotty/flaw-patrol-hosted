import { describe, expect, it } from "vitest";
import { cleanZone, dayIn, rangeDays } from "./zone";
import { clockTime, dateRange, dayName, shortDate } from "./spelling";

describe("viewer time zone (ver_137)", () => {
  it("keeps real zones only", () => {
    expect(cleanZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(cleanZone("Not/AZone")).toBe("UTC");
    expect(cleanZone(undefined)).toBe("UTC");
  });
  it("shows a 1:35 AM UTC bug bash on the Pacific evening before, in each Language", () => {
    const at = new Date("2026-11-02T01:35:00Z");
    const la = "America/Los_Angeles";
    expect(`${shortDate(at, "us", la)}, ${clockTime(at, "us", la)}`).toBe("Nov 1, 5:35 PM");
    expect(`${shortDate(at, "uk", la)}, ${clockTime(at, "uk", la)}`).toBe("1 Nov, 17:35");
    expect(dayName(at, "us", la)).toBe("Sun, Nov 1");
    expect(dayIn(at, la)).toBe("2026-11-01");
    expect(dayIn(at, "UTC")).toBe("2026-11-02");
  });
  it("ends the default report range today on the viewer's clock, and keeps typed days as typed", () => {
    const now = new Date("2026-11-02T01:35:00Z");
    const from = new Date(now.getTime() - 30 * 86400_000);
    const d = rangeDays(from, now, {}, "America/Los_Angeles");
    expect(dateRange(d.from, d.to, "us").replace(/\s/g, " ")).toBe("Oct 2 – Nov 1, 2026");
    const typed = rangeDays(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T23:59:59Z"), { from: "2026-10-01", to: "2026-10-31" }, "America/Los_Angeles");
    expect(dateRange(typed.from, typed.to, "uk").replace(/\s/g, " ")).toBe("1 – 31 Oct 2026");
  });
});
