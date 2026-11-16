import { afterEach, describe, expect, it, vi } from "vitest";
import { adminEmails, envMicrosoft, ssoOnly } from "./sso-only";

afterEach(() => vi.unstubAllEnvs());

describe("company sign-in only settings", () => {
  it("reads AUTH_SSO_ONLY as a yes/no", () => {
    for (const v of ["true", "1", "YES", " on "]) {
      vi.stubEnv("AUTH_SSO_ONLY", v);
      expect(ssoOnly()).toBe(true);
    }
    for (const v of ["", "false", "0", "nope"]) {
      vi.stubEnv("AUTH_SSO_ONLY", v);
      expect(ssoOnly()).toBe(false);
    }
  });
  it("lists admin emails in lower case and skips things that aren't emails", () => {
    expect([...adminEmails(" Boss@Example.com, ,not-an-email, ada@x.org ")]).toEqual(["boss@example.com", "ada@x.org"]);
    expect(adminEmails(undefined).size).toBe(0);
  });
  it("only uses Microsoft from the server when all three settings are there", () => {
    vi.stubEnv("AUTH_MICROSOFT_TENANT_ID", "4F2A1C3E-0B7D-4E21-9A55-1D2F3C4B5A6E");
    vi.stubEnv("AUTH_MICROSOFT_ID", "app");
    vi.stubEnv("AUTH_MICROSOFT_SECRET", "");
    expect(envMicrosoft()).toBeNull();
    vi.stubEnv("AUTH_MICROSOFT_SECRET", "s");
    expect(envMicrosoft()).toEqual({ tenantId: "4f2a1c3e-0b7d-4e21-9a55-1d2f3c4b5a6e", clientId: "app", clientSecret: "s" });
  });
});
