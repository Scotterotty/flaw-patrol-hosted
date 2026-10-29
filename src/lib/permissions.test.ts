import { describe, expect, it } from "vitest";
import { can, parseRoleRules, roleSummary } from "./permissions";

describe("can", () => {
  it("lets testers edit cases but not manage shared steps or members", () => {
    expect(can("TESTER", "case:edit")).toBe(true);
    expect(can("TESTER", "shared:manage")).toBe(false);
    expect(can("TESTER", "project:manage")).toBe(false);
  });
  it("lets leads import and manage folders, and admins do everything", () => {
    expect(can("LEAD", "import")).toBe(true);
    expect(can("LEAD", "project:manage")).toBe(false);
    expect(can("ADMIN", "project:manage")).toBe(true);
  });
  it("denies non-members", () => {
    expect(can(null, "case:edit")).toBe(false);
  });
});

describe("roles per umbrella (ver_82)", () => {
  it("keeps Standard when no rules are saved", () => {
    expect(can({ role: "TESTER", rules: null }, "run:manage")).toBe(false);
    expect(can({ role: "LEAD", rules: null }, "run:manage")).toBe(true);
  });
  it("lets testers do everything but archive and delete under Open", () => {
    const open = { role: "TESTER" as const, rules: parseRoleRules({ preset: "open" }) };
    expect(can(open, "run:manage")).toBe(true);
    expect(can(open, "shared:manage")).toBe(true);
    expect(can(open, "run:delete")).toBe(false);
    expect(can(open, "cycle:archive")).toBe(false);
    expect(can(open, "members:manage")).toBe(false);
  });
  it("follows the ticked boxes under Custom, and admins can always do everything", () => {
    const rules = parseRoleRules({ preset: "custom", allow: { close: ["TESTER"], runs: [] } });
    expect(can({ role: "TESTER", rules }, "run:manage")).toBe(true);
    expect(can({ role: "LEAD", rules }, "run:manage")).toBe(false);
    expect(can({ role: "ADMIN", rules }, "run:manage")).toBe(true);
    expect(can({ role: "ADMIN", rules }, "members:manage")).toBe(true);
  });
  it("ignores rules it can't read", () => {
    expect(parseRoleRules({ preset: "nonsense" })).toBeNull();
    expect(parseRoleRules(null)).toBeNull();
  });
});

describe("roleSummary (ver_91)", () => {
  it("is written from the grid", () => {
    const s = roleSummary();
    expect(s).toMatch(/^Viewers see everything, flag cases and join bug bashes. Members write cases, run tests, file bugs and move requirements on the risk board\. Leads also import, organize folders/);
    expect(s).toContain("Admins also move cases into the Case library");
    expect(s).toContain("manage members and roles");
  });
});
