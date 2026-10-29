import { describe, expect, it } from "vitest";
import { CSP_FIELD, fieldBits, parseRunFields, pickValues, readFieldInput, type RunField } from "./run-fields";

const region: RunField = { id: "region-ab12", name: "Region", type: "list", choices: ["EU", "US"], required: true, rc: false, jira: true };

describe("run fields", () => {
  it("reads CSP version into its own column and the rest by id", () => {
    expect(readFieldInput([CSP_FIELD, region], { csp: " 0.22.1 ", "region-ab12": "EU" })).toEqual({ cspVersion: "0.22.1", fields: [{ id: "region-ab12", name: "Region", value: "EU" }] });
  });
  it("leaves CSP alone when the umbrella has no CSP field", () => {
    expect(readFieldInput([], { csp: "1" }).cspVersion).toBeUndefined();
  });
  it("asks for required fields and checks list choices", () => {
    expect(() => readFieldInput([region], {})).toThrow("Fill in Region.");
    expect(() => readFieldInput([region], { "region-ab12": "Mars" })).toThrow("isn't one of the Region choices");
    expect(readFieldInput([region], {}, { strict: false }).fields[0].value).toBe("");
  });
  it("shows filled fields on a run, and picks the ones for RC status or Jira", () => {
    const run = { cspVersion: "0.22.1", fields: [{ id: "region-ab12", name: "Region", value: "EU" }] };
    expect(fieldBits(run)).toEqual(["CSP 0.22.1", "Region EU"]);
    expect(pickValues(run, [CSP_FIELD, region], "rc").map((v) => v.name)).toEqual(["CSP version"]);
    expect(pickValues(run, [CSP_FIELD, region], "jira").map((v) => v.name)).toEqual(["CSP version", "Region"]);
  });
  it("ignores junk in stored settings", () => {
    expect(parseRunFields([{ id: "a", name: "A", type: "weird" }, null, 3])).toEqual([{ id: "a", name: "A", type: "text", choices: [], required: false, rc: false, jira: false }]);
  });
});
