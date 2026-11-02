import { describe, expect, it } from "vitest";
import { inviteTitle } from "./invite-title";

describe("inviteTitle", () => {
  it("names the inviter and the umbrella", () => {
    expect(inviteTitle("Demo Admin", ["Mobile App"])).toBe("Demo Admin invited you to Mobile App");
  });
  it("counts the rest once each", () => {
    expect(inviteTitle("Demo Admin", ["Mobile App", "Web", "Mobile App", "Desktop"])).toBe("Demo Admin invited you to Mobile App and 2 more");
  });
  it("falls back when the inviter or place is missing", () => {
    expect(inviteTitle(null, ["Mobile App"])).toBe("You're invited to Flaw Patrol");
    expect(inviteTitle("Demo Admin", [])).toBe("You're invited to Flaw Patrol");
    expect(inviteTitle("  ", ["  "])).toBe("You're invited to Flaw Patrol");
  });
});
