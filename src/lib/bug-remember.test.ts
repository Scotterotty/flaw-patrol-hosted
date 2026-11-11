import { describe, expect, it } from "vitest";
import { envOf, parseProfile, rememberedFor, rememberInto, type TemplateBug } from "./bug-template";

const bug = (clientTag: string, envTenant: string, user: string, context = "Windows 11\nRTX 4070") =>
  ({ clientTag, history: { dateTime: "", client: "", csp: "", context, user, envTenant, repros: "" } }) as unknown as TemplateBug;

describe("remembered Context and User name & ID (roomier bug form)", () => {
  it("keeps User name & ID per environment, Context per client", () => {
    let p = rememberInto({}, bug("WEB", "o2QA\nmagnopus-qa", "scott.qa · 4f2a"));
    p = rememberInto(p, bug("WEB", "o2Prod\nmagnopus", "scott · 91c7"));
    expect(rememberedFor(p, "WEB", "o2QA")).toEqual({ context: "Windows 11\nRTX 4070", user: "scott.qa · 4f2a", tenant: "magnopus-qa" });
    expect(rememberedFor(p, "WEB", "O2PROD").user).toBe("scott · 91c7");
  });

  it("falls back to the client's last answer in a new environment, and blank for a new client", () => {
    const p = rememberInto({}, bug("UNITY", "o2QA", "sam · 11"));
    expect(rememberedFor(p, "UNITY", "o2Dev").user).toBe("sam · 11");
    expect(rememberedFor(p, "WEB", "o2QA")).toEqual({ context: "", user: "", tenant: "" });
  });

  it("reads profiles saved before environments were kept", () => {
    const old = parseProfile({ WEB: { context: "macOS", user: "old", tenant: "t" } });
    expect(rememberedFor(old, "WEB", "o2QA")).toEqual({ context: "macOS", user: "old", tenant: "t" });
  });

  it("splits the environment line off Env & tenant", () => {
    expect(envOf("o2QA\nmagnopus-qa")).toBe("o2QA");
    expect(envOf("")).toBe("");
  });
});
