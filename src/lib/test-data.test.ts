import { describe, expect, it } from "vitest";
import {
  addPasted,
  combineResults,
  fillRow,
  parsePasted,
  parseTestData,
  rowLabel,
  rowResults,
  rowSummary,
  rowsLine,
  testDataChanges,
  testDataProblem,
  testDataWarnings,
  toColumnName,
  valuesUsed,
  type TestData,
} from "./test-data";
import { expandForRun, stepLabel, type SharedStepDef } from "./steps";
import { rowsOfResult, rowsTip } from "./test-data-history";

const roles: TestData = { columns: ["browser", "role"], rows: [["Chrome", "admin"], ["Safari", "viewer"], ["Firefox", "guest"]] };

describe("test data", () => {
  it("fills a row's values into blanks and leaves unknown blanks", () => {
    expect(fillRow("Sign in as {{role}} in {{ browser }} on {{os}}", roles, 1)).toBe("Sign in as viewer in Safari on {{os}}");
    expect(valuesUsed("Sign in as {{role}} in {{browser}}", roles, 2)).toEqual(["guest", "Firefox"]);
  });

  it("labels and spells out rows", () => {
    expect(rowLabel(roles, 1)).toBe("Safari · viewer");
    expect(rowSummary(roles, 0)).toBe("browser = Chrome, role = admin");
  });

  it("turns typed names into column names", () => {
    expect(toColumnName("user role")).toBe("user_role");
    expect(toColumnName("2fa?")).toBe("_2fa");
  });

  it("drops empty rows and treats an empty table as none", () => {
    expect(parseTestData({ columns: ["role"], rows: [["admin"], [" "]] })).toEqual({ columns: ["role"], rows: [["admin"]] });
    expect(parseTestData({ columns: ["role"], rows: [[""]] })).toBeNull();
    expect(parseTestData(null)).toBeNull();
    expect(parseTestData({ columns: ["a", "A"], rows: [["1", "2"]] })).toBeNull();
  });

  it("says what stops a table saving", () => {
    expect(testDataProblem(null)).toBeNull();
    expect(testDataProblem({ columns: [""], rows: [["x"]] })).toMatch(/name/);
    expect(testDataProblem({ columns: ["role"], rows: [[""]] })).toMatch(/no values/);
    expect(testDataProblem(roles)).toBeNull();
  });

  it("warns about unused columns and blanks with no column", () => {
    const w = testDataWarnings(roles, [{ step: 1, text: "Sign in as {{role}} with {{device}}" }], []);
    expect(w.unusedColumns).toEqual(["browser"]);
    expect(w.missing).toEqual([{ name: "device", step: 1 }]);
    expect(testDataWarnings(roles, [{ step: 1, text: "{{role}}" }], ["browser"]).unusedColumns).toEqual([]);
  });

  it("passes the case only when every row passes, else the worst row", () => {
    expect(combineResults(["PASSED", "PASSED"])).toBe("PASSED");
    expect(combineResults(["PASSED", "FAILED", "BLOCKED"])).toBe("FAILED");
    expect(combineResults(["PASSED", "SKIPPED"])).toBe("SKIPPED");
    expect(combineResults(["PASSED", "UNTESTED"])).toBe("IN_PROGRESS");
    expect(combineResults(["UNTESTED", "UNTESTED"])).toBe("UNTESTED");
  });

  it("works out each row's result from step results", () => {
    const rowOf = [0, 0, 1, 1, 2, 2];
    expect(rowResults(rowOf, ["PASSED", "PASSED", "PASSED", "FAILED", "UNTESTED", "UNTESTED"], 3)).toEqual(["PASSED", "FAILED", "UNTESTED"]);
    expect(rowResults(rowOf, ["PASSED", "UNTESTED", "PASSED", "PASSED", "PASSED", "PASSED"], 3)).toEqual(["IN_PROGRESS", "PASSED", "PASSED"]);
    expect(rowsLine(["PASSED", "FAILED", "PASSED"])).toBe("2 of 3 rows passed");
  });

  it("reads rows pasted from a sheet, first row as names on an empty table", () => {
    expect(parsePasted("browser\trole\nChrome\tadmin\r\nSafari\tviewer\n")).toEqual([["browser", "role"], ["Chrome", "admin"], ["Safari", "viewer"]]);
    const { data, cut } = addPasted({ columns: [], rows: [] }, parsePasted("Browser\tUser role\nChrome\tadmin"));
    expect(data).toEqual({ columns: ["Browser", "User_role"], rows: [["Chrome", "admin"]] });
    expect(cut).toBe(0);
    // The table + Add test data starts with (a column, empty rows) also takes the header row.
    expect(addPasted({ columns: ["role"], rows: [[""], [""]] }, parsePasted("role\nadmin\nviewer")).data).toEqual({ columns: ["role"], rows: [["admin"], ["viewer"]] });
    const more = addPasted(roles, Array.from({ length: 20 }, (_, i) => [`B${i}`, `r${i}`]));
    expect(more.data.rows).toHaveLength(20);
    expect(more.cut).toBe(3);
  });

  it("describes table changes between versions", () => {
    expect(testDataChanges(null, roles)).toEqual(["Test data added: 3 rows."]);
    expect(testDataChanges(roles, null)).toEqual(["Test data removed."]);
    expect(testDataChanges({ ...roles, rows: roles.rows.slice(0, 2) }, roles)).toEqual(["Rows: 2 → 3."]);
    expect(testDataChanges(roles, { ...roles, rows: [["Edge", "admin"], ...roles.rows.slice(1)] })).toEqual(["Values changed."]);
  });
});

describe("running a case with test data", () => {
  const env: SharedStepDef = {
    id: "s1",
    name: "Open {{env}}",
    version: 2,
    parameters: [
      { name: "env", defaultValue: "staging" },
      { name: "region", defaultValue: "" },
    ],
    steps: [{ action: "Open the space in {{env}} ({{region}})", expected: "Space loads" }],
  };
  const defs = new Map([[env.id, env]]);
  const items = [
    { kind: "step" as const, action: "Sign in as {{role}}", expected: "Home page shows" },
    { kind: "shared" as const, sharedStepId: "s1", params: { region: "US-West", env: "prod" } },
  ];
  const data: TestData = { columns: ["role", "env"], rows: [["admin", "staging"], ["viewer", "prod"]] };

  it("repeats the steps once per row with that row's values", () => {
    const steps = expandForRun(items, defs, data);
    expect(steps.map((s) => [s.row, s.number, s.action])).toEqual([
      [0, "1", "Sign in as admin"],
      [0, "2", "Open the space in staging (US-West)"],
      [1, "1", "Sign in as viewer"],
      [1, "2", "Open the space in prod (US-West)"],
    ]);
    expect(steps[3].shared?.name).toBe("Open prod");
    expect(steps[2].vals).toEqual(["viewer"]);
    expect(stepLabel(steps[3])).toBe("Row 2, step 2");
  });

  it("leaves cases without test data as they were", () => {
    const steps = expandForRun(items, defs, null);
    expect(steps.map((s) => s.action)).toEqual(["Sign in as {{role}}", "Open the space in prod (US-West)"]);
    expect(steps[0].row).toBeUndefined();
    expect(stepLabel(steps[0])).toBe("Step 1");
  });

  it("reads each row's result back for history pips", () => {
    const steps = expandForRun(items, defs, data);
    const rows = rowsOfResult(steps, [{ status: "PASSED" }, { status: "PASSED" }, { status: "FAILED" }, { status: "PASSED" }]);
    expect(rows).toEqual(["PASSED", "FAILED"]);
    expect(rowsTip(rows!)).toBe("Row 2 failed. Row 1 passed.");
    expect(rowsOfResult(expandForRun(items, defs, null), [{ status: "PASSED" }, { status: "PASSED" }])).toBeNull();
  });
});
