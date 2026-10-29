import { describe, expect, it } from "vitest";
import { can, parseRoleRules, roleSummary } from "./permissions";

describe("can (open by default, ver_96)", () => {
  it("lets members use every feature but archive, delete, connections and members", () => {
    expect(can("TESTER", "case:edit")).toBe(true);
    expect(can("TESTER", "shared:manage")).toBe(true);
    expect(can("TESTER", "import")).toBe(true);
    expect(can("TESTER", "project:manage")).toBe(true);
    expect(can("TESTER", "cycle:create")).toBe(true);
    expect(can("TESTER", "project:group")).toBe(true);
    expect(can("TESTER", "run:delete")).toBe(false);
    expect(can("TESTER", "case:archive")).toBe(false);
    expect(can("TESTER", "jira:manage")).toBe(false);
    expect(can("TESTER", "project:separate")).toBe(false);
    expect(can("TESTER", "members:manage")).toBe(false);
  });
  it("makes leads the same as members, and admins do everything", () => {
    expect(can("LEAD", "run:delete")).toBe(false);
    expect(can("LEAD", "folder:delete")).toBe(false);
    expect(can("ADMIN", "run:delete")).toBe(true);
    expect(can("ADMIN", "members:manage")).toBe(true);
  });
  it("keeps viewers read-only", () => {
    expect(can("VIEWER", "case:edit")).toBe(false);
    expect(can("VIEWER", "run:execute")).toBe(false);
    expect(can("VIEWER", "case:flag")).toBe(true);
    expect(can("VIEWER", "bash:join")).toBe(true);
  });
  it("denies non-members", () => {
    expect(can(null, "case:edit")).toBe(false);
  });
});

describe("presets", () => {
  it("reads old Standard and Open rules as Everyone", () => {
    expect(parseRoleRules({ preset: "open" })).toBeNull();
    expect(parseRoleRules({ preset: "standard" })).toBeNull();
  });
  it("Tighter is the old Standard with archive and delete for admins", () => {
    const rules = parseRoleRules({ preset: "tighter" });
    expect(can({ role: "TESTER", rules }, "run:manage")).toBe(false);
    expect(can({ role: "LEAD", rules }, "run:manage")).toBe(true);
    expect(can({ role: "LEAD", rules }, "library:move")).toBe(true);
    expect(can({ role: "LEAD", rules }, "run:delete")).toBe(false);
    expect(can({ role: "TESTER", rules }, "run:execute")).toBe(true);
  });
  it("follows the ticked boxes under Custom, and admins can always do everything", () => {
    const rules = parseRoleRules({ preset: "custom", allow: { close: ["LEAD"], runs: [] } });
    expect(can({ role: "TESTER", rules }, "run:manage")).toBe(false);
    expect(can({ role: "LEAD", rules }, "run:manage")).toBe(true);
    expect(can({ role: "TESTER", rules }, "run:create")).toBe(false);
    expect(can({ role: "ADMIN", rules }, "run:manage")).toBe(true);
    expect(can({ role: "ADMIN", rules }, "members:manage")).toBe(true);
  });
  it("ignores rules it can't read", () => {
    expect(parseRoleRules({ preset: "nonsense" })).toBeNull();
    expect(parseRoleRules(null)).toBeNull();
  });
});

describe("roleSummary", () => {
  it("is written from the grid", () => {
    const s = roleSummary();
    expect(s).toMatch(/^Viewers see everything, flag cases and join bug bashes. Members write cases, import/);
    expect(s).toContain("Leads can do the same as Members.");
    expect(s).toContain("manage members and roles");
  });
});
