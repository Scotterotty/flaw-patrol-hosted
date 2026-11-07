import { describe, expect, it } from "vitest";
import { fullDate, madeAt, zoneName } from "./spelling";
import { dayIn } from "./zone";

// ver_197: a report made at 5:42 PM Pacific on Friday Nov 6 (01:42 UTC Saturday) said "Sat Nov 07 2026".
const friday542pm = new Date("2026-11-07T01:42:00Z");

describe("report dates on the reader's clock", () => {
  it("says Friday for someone in California", () => {
    expect(fullDate(friday542pm, "us", "America/Los_Angeles")).toBe("Friday, Nov 6, 2026");
    expect(madeAt(friday542pm, "us", "America/Los_Angeles")).toBe("Nov 6, 2026, 5:42 PM PST");
    expect(dayIn(friday542pm, "America/Los_Angeles")).toBe("2026-11-06");
  });

  it("says Saturday in the UK date order for a UK teammate", () => {
    expect(fullDate(friday542pm, "uk", "Europe/London")).toBe("Saturday, 7 Nov 2026");
    expect(madeAt(friday542pm, "uk", "Europe/London")).toBe("7 Nov 2026, 01:42 GMT");
    expect(dayIn(friday542pm, "Europe/London")).toBe("2026-11-07");
  });

  it("labels UTC when the reader's zone isn't known", () => {
    expect(zoneName(friday542pm, "UTC")).toBe("UTC");
    expect(madeAt(friday542pm, "us", "UTC")).toBe("Nov 7, 2026, 1:42 AM UTC");
  });
});
