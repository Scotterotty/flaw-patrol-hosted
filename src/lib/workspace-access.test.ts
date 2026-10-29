import { describe, expect, it } from "vitest";
import { activityWhere, pageSize } from "./activity-query";
import { renderMail } from "./mail-render";
import { domainList, emailInDomains, emailTrusted, GUID } from "./sign-in-rules";

describe("Company sign-in rules", () => {
  it("reads domain lists however people type them", () => {
    expect(domainList(" Example.com, @example.org;team.example.net ")).toEqual(["example.com", "example.org", "team.example.net"]);
    expect(domainList("")).toEqual([]);
    expect(emailInDomains("sam@example.com", ["example.com"])).toBe(true);
    // A look-alike domain is not the same domain.
    expect(emailInDomains("sam@notexample.com", ["example.com"])).toBe(false);
  });

  it("only takes a real Microsoft directory (tenant) ID, never common or organizations", () => {
    expect(GUID.test("4f2a1c3e-0b7d-4e21-9a55-1d2f3c4b5a6e")).toBe(true);
    expect(GUID.test("common")).toBe(false);
    expect(GUID.test("organizations")).toBe(false);
  });

  it("matches existing accounts only on emails the sign-in service vouches for", () => {
    expect(emailTrusted("google", { email: "a@example.com", email_verified: true })).toBe(true);
    expect(emailTrusted("google", { email: "a@example.com" })).toBe(false);
    expect(emailTrusted("oidc", { email: "a@example.com", email_verified: false })).toBe(false);
    expect(emailTrusted("oidc", { email: "a@example.com" })).toBe(true);
    expect(emailTrusted("microsoft", { preferred_username: "a@example.com" })).toBe(true);
  });
});

describe("Activity log filters", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("defaults to the last 30 days and ignores unknown types", () => {
    const w = activityWhere({ kind: "results" }, now);
    expect(w.at).toEqual({ gte: new Date("2026-09-28T12:00:00Z") });
    expect(w.kind).toBeUndefined();
  });
  it("searches what, details, who and where, and can show everything kept", () => {
    const w = activityWhere({ q: "CHK-48", days: "all", kind: "delete", who: "u1", umbrella: "g1" }, now);
    expect(w.at).toBeUndefined();
    expect(w).toMatchObject({ kind: "delete", actorId: "u1", groupId: "g1" });
    expect(w.OR).toHaveLength(4);
  });
  it("shows 100 entries at a time, up to 2,000", () => {
    expect(pageSize({})).toBe(100);
    expect(pageSize({ limit: "300" })).toBe(300);
    expect(pageSize({ limit: "999999" })).toBe(2000);
  });
});

describe("Invite emails", () => {
  it("escapes names in the HTML and keeps a plain text version with the link", () => {
    const m = renderMail({ to: "sam@example.com", subject: "x", lines: ["<b>Morgan</b> added you to Checkout as a Tester."], button: { label: "Accept invite", url: "https://qa.example.com/invite/abc" }, footer: "Works once." });
    expect(m.html).toContain("&lt;b&gt;Morgan&lt;/b&gt;");
    expect(m.html).not.toContain("<b>Morgan");
    expect(m.text).toBe("<b>Morgan</b> added you to Checkout as a Tester.\n\nAccept invite: https://qa.example.com/invite/abc\n\nWorks once.");
  });
});
