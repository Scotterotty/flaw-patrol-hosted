import { describe, expect, it } from "vitest";
import { seasonFor } from "./seasons";

const on = (d: string) => seasonFor(new Date(`${d}T12:00:00Z`));

describe("seasonFor", () => {
  it("picks the season by month and day", () => {
    expect(on("2027-03-01")).toBe("spring");
    expect(on("2027-05-31")).toBe("spring");
    expect(on("2027-06-01")).toBe("summer");
    expect(on("2027-08-31")).toBe("summer");
    expect(on("2027-09-01")).toBe("fall");
    expect(on("2027-11-30")).toBe("fall");
    expect(on("2027-12-01")).toBe("winter");
    expect(on("2027-02-28")).toBe("winter");
    expect(on("2028-02-29")).toBe("winter");
  });

  it("puts Halloween on top of fall, Oct 15 to 31", () => {
    expect(on("2026-10-14")).toBe("fall");
    expect(on("2026-10-15")).toBe("halloween");
    expect(on("2026-10-31")).toBe("halloween");
    expect(on("2026-11-01")).toBe("fall");
  });

  it("puts Winter lights on top of winter, Dec 15 to Jan 1", () => {
    expect(on("2026-12-14")).toBe("winter");
    expect(on("2026-12-15")).toBe("lights");
    expect(on("2027-01-01")).toBe("lights");
    expect(on("2027-01-02")).toBe("winter");
  });
});
