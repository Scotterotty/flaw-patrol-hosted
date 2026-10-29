import { describe, expect, it } from "vitest";
import { cleanSteps, expandSteps, fillPlaceholders, placeholdersIn, type SharedStepDef } from "./steps";

const login: SharedStepDef = {
  id: "s1",
  name: "Log in",
  version: 3,
  parameters: [
    { name: "role", defaultValue: "admin" },
    { name: "env", defaultValue: "" },
  ],
  steps: [
    { action: "Open {{ env }} login page", expected: "" },
    { action: "Sign in as {{role}}", expected: "{{role}} dashboard shows" },
  ],
};

describe("placeholders", () => {
  it("lists names in order without duplicates", () => {
    expect(placeholdersIn(login.steps)).toEqual(["env", "role"]);
  });
  it("uses the case value, then the default, else leaves the placeholder", () => {
    expect(fillPlaceholders("as {{role}} on {{env}}", login.parameters, { role: "tester" })).toBe("as tester on {{env}}");
    expect(fillPlaceholders("as {{role}}", login.parameters, {})).toBe("as admin");
  });
});

describe("expandSteps", () => {
  it("expands shared steps inline with sub-numbers", () => {
    const steps = expandSteps(
      [
        { kind: "shared", sharedStepId: "s1", params: { role: "lead", env: "staging" } },
        { kind: "step", action: "Open reports", expected: "Reports list" },
        { kind: "shared", sharedStepId: "gone", params: {} },
      ],
      new Map([["s1", login]]),
    );
    expect(steps.map((s) => [s.number, s.action, s.expected])).toEqual([
      ["1.1", "Open staging login page", ""],
      ["1.2", "Sign in as lead", "lead dashboard shows"],
      ["2", "Open reports", "Reports list"],
      ["3", "[Missing shared step]", ""],
    ]);
    expect(steps[0].shared).toEqual({ id: "s1", name: "Log in", version: 3 });
  });
});

describe("cleanSteps", () => {
  it("drops blank plain steps only", () => {
    expect(
      cleanSteps([
        { kind: "step", action: " ", expected: "" },
        { kind: "shared", sharedStepId: "s1", params: {} },
        { kind: "step", action: "", expected: "x" },
      ]),
    ).toHaveLength(2);
  });
});
