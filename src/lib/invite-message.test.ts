import { describe, expect, it } from "vitest";
import { inviteMessage, linkUntil } from "./invite-message";

describe("invite message (ver_114)", () => {
  it("carries the one-time link, not the sign-in page", () => {
    const m = inviteMessage("Web storefront", "https://fp.example.com/invite/abc");
    expect(m).toBe("You're invited to Web storefront in Flaw Patrol. Open this link to choose your password and sign in: https://fp.example.com/invite/abc (works once, for 7 days)");
    expect(m).not.toContain("/signin");
  });
  it("shows the end date as month and day", () => {
    expect(linkUntil(new Date(2026, 10, 7, 12))).toBe("Nov 7");
  });
});
