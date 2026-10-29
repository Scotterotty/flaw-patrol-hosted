import { describe, expect, it } from "vitest";
import { bucketKey, bucketKeys, bucketLabel, unitFor } from "./trend-buckets";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("trend buckets", () => {
  it("picks days, weeks or months from the range", () => {
    expect(unitFor(d("2026-10-01"), d("2026-10-20"))).toBe("day");
    expect(unitFor(d("2026-06-01"), d("2026-10-20"))).toBe("week");
    expect(unitFor(d("2025-01-01"), d("2026-10-20"))).toBe("month");
  });
  it("starts weeks on Monday and months on the 1st", () => {
    expect(bucketKey(d("2026-10-20"), "week")).toBe("2026-10-19"); // a Tuesday
    expect(bucketKey(d("2026-10-18"), "week")).toBe("2026-10-12"); // a Sunday
    expect(bucketKey(d("2026-10-20"), "month")).toBe("2026-10-01");
  });
  it("lists every bucket in the range, empty ones included", () => {
    expect(bucketKeys(d("2026-10-18"), d("2026-10-20"), "day")).toEqual(["2026-10-18", "2026-10-19", "2026-10-20"]);
    expect(bucketKeys(d("2026-10-01"), d("2026-10-20"), "week")).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(bucketKeys(d("2026-08-15"), d("2026-10-20"), "month")).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });
  it("labels buckets briefly", () => {
    expect(bucketLabel("2026-10-19", "week")).toBe("Oct 19");
    expect(bucketLabel("2026-10-01", "month")).toBe("Oct 2026");
  });
});
