import { describe, expect, it } from "vitest";
import { hashLinkToken, hashPassword, newLinkToken, passwordProblem, verifyPassword } from "./password";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("correct horse batterY", h)).toBe(false);
    expect(await hashPassword("correct horse battery")).not.toBe(h);
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword("x", "plain")).toBe(false);
  });

  it("checks new passwords", () => {
    expect(passwordProblem("short")).toMatch(/at least 8/);
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/harder/);
    expect(passwordProblem("Me@Example.com", "me@example.com")).toMatch(/email/);
    expect(passwordProblem("a decent passphrase")).toBeNull();
  });

  it("makes link tokens whose hash matches", () => {
    const { token, tokenHash } = newLinkToken();
    expect(token.length).toBeGreaterThan(40);
    expect(hashLinkToken(token)).toBe(tokenHash);
  });
});
