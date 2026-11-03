import { describe, expect, it } from "vitest";
import { bashIcs, icsFileName, localBoxes, localInstant, nextHour, startProblem, startsIn, whenLabel } from "./bash-schedule";

// ver_153: bug bashes scheduled days ahead.

describe("scheduled bug bashes", () => {
  it("counts down in days when it's more than a day away", () => {
    expect(startsIn(3 * 86_400 + 500)).toBe("3 days");
    expect(startsIn(2 * 86_400)).toBe("2 days");
    expect(startsIn(86_400 + 60)).toBe("1 day");
    expect(startsIn(3 * 3600 + 12 * 60 + 40)).toBe("3:12:40");
    expect(startsIn(-5)).toBe("0:00");
  });

  it("shows the day and time on each viewer's own clock", () => {
    const at = "2026-11-06T18:00:00Z";
    expect(whenLabel(at, "America/Los_Angeles")).toBe("Fri, Nov 6 · 10:00 AM PST");
    expect(whenLabel(at, "Europe/London")).toBe("Fri, Nov 6 · 6:00 PM GMT");
  });

  it("reads the date and time boxes as one moment, and back", () => {
    const at = localInstant("2026-11-06", "10:00")!;
    expect(localBoxes(at)).toEqual({ day: "2026-11-06", time: "10:00" });
    expect(localInstant("", "10:00")).toBeNull();
    expect(localInstant("2026-11-06", "")).toBeNull();
  });

  it("starts the time box at the next whole hour", () => {
    const d = nextHour(new Date(2026, 10, 3, 9, 41));
    expect([d.getHours(), d.getMinutes()]).toEqual([10, 0]);
  });

  it("refuses a time that passed, none at all, or more than a year out", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(startProblem(null, now)).toMatch(/Pick a date/);
    expect(startProblem(new Date("2026-11-03T11:00:00Z"), now)).toMatch(/already passed/);
    expect(startProblem(new Date("2028-01-01T00:00:00Z"), now)).toMatch(/next year/);
    expect(startProblem(new Date("2026-11-06T18:00:00Z"), now)).toBeNull();
  });

  it("makes a calendar invite in UTC with the Join link and a 10-minute reminder", () => {
    const ics = bashIcs(
      { id: "b1", name: "Checkout, 2.4; final", startsAt: "2026-11-06T18:00:00Z", endsAt: "2026-11-06T19:00:00Z", areas: ["Cart", "Payment"], url: "https://fp.example.com/p/HUB/bashes/b1?join=1", by: "Scott" },
      new Date("2026-11-03T12:00:00Z"),
    );
    expect(ics).toContain("DTSTART:20261106T180000Z\r\n");
    expect(ics).toContain("DTEND:20261106T190000Z\r\n");
    expect(ics).toContain("UID:bash-b1@flaw-patrol");
    expect(ics).toContain("SUMMARY:Bug bash · Checkout\\, 2.4\\; final");
    expect(ics).toContain("TRIGGER:-PT10M");
    expect(ics.replace(/\r\n /g, "")).toContain("Join here: https://fp.example.com/p/HUB/bashes/b1?join=1");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("names the file after the bash", () => {
    expect(icsFileName("Checkout 2.4!")).toBe("bug-bash-checkout-2-4.ics");
    expect(icsFileName("🐞")).toBe("bug-bash.ics");
  });
});
