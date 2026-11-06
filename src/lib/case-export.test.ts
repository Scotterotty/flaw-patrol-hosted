import { describe, expect, it } from "vitest";
import { csvFile, exportFileName, qaseTable, qtestTable, sheetTable, testrailTable, type ExportCase } from "./case-export";

const login: ExportCase = {
  key: "WEB-12",
  sourceKey: "PQ-1708",
  title: "Sign in with email",
  folder: ["Web", "Login"],
  preconditions: "Signed out",
  priority: "HIGH",
  automated: false,
  automationId: null,
  tags: ["Web", "Smoke"],
  requirements: ["APP-3"],
  steps: [
    { number: "1", action: "Open the sign-in page", expected: "The form shows" },
    { number: "2", action: "Type £ and é", expected: "Signed in" },
  ],
};
const bare: ExportCase = { ...login, key: "WEB-13", sourceKey: null, title: "Title only", folder: [], tags: [], requirements: [], priority: "CRITICAL", automated: true, automationId: "login.spec", steps: [] };
const nested: ExportCase = { ...login, key: "WEB-14", title: "SSO", folder: ["Web", "Login", "SSO"] };

describe("Export cases", () => {
  it("spreadsheet: case on its first row, one row per step", () => {
    const t = sheetTable([login, bare]);
    expect(t.header[0]).toBe("ID");
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0].slice(0, 3)).toEqual(["WEB-12", "Sign in with email", "Web / Login"]);
    expect(t.rows[1][1]).toBe("");
    expect(t.rows[1].slice(-2)).toEqual(["Type £ and é", "Signed in"]);
    // A case with no steps still gets its row.
    expect(t.rows[2][1]).toBe("Title only");
    expect(t.starts).toEqual([0, 2]);
  });

  it("qTest keeps an imported PQ key and the module path", () => {
    const t = qtestTable([login]);
    expect(t.rows[0].slice(0, 3)).toEqual(["PQ-1708", "Sign in with email", "Web/Login"]);
    expect(t.rows[0].slice(-3)).toEqual(["1", "Open the sign-in page", "The form shows"]);
  });

  it("TestRail: section, hierarchy, references and separated steps", () => {
    const t = testrailTable([login]);
    const at = (h: string) => t.rows[0][t.header.indexOf(h)];
    expect(at("Section")).toBe("Login");
    expect(at("Section Hierarchy")).toBe("Web > Login");
    expect(at("References")).toBe("APP-3");
    expect(t.rows[1][t.header.indexOf("Steps (Step)")]).toBe("Type £ and é");
  });

  it("Qase: one row per case, numbered steps, nested suites", () => {
    const t = qaseTable([login, bare, nested]);
    const col = (r: number, h: string) => t.rows[r][t.header.indexOf(h)];
    expect(t.rows).toHaveLength(3);
    expect(col(0, "steps_actions")).toBe("1. Open the sign-in page\n2. Type £ and é");
    expect(col(0, "steps_result")).toBe("1. The form shows\n2. Signed in");
    expect(col(0, "priority")).toBe("high");
    expect(col(1, "priority")).toBe("high");
    expect(col(1, "severity")).toBe("critical");
    expect(col(1, "automation")).toBe("automated");
    expect(col(1, "suite_id")).toBe("");
    // SSO sits under Login.
    expect(col(2, "suite_parent_id")).toBe(col(0, "suite_id"));
    expect(col(2, "suite")).toBe("SSO");
  });

  it("test data rows are named in the steps", () => {
    const t = qaseTable([{ ...login, steps: [{ number: "1", action: "Sign in as admin", expected: "", row: 0 }, { number: "1", action: "Sign in as viewer", expected: "", row: 1 }] }]);
    expect(t.rows[0][t.header.indexOf("steps_actions")]).toBe("1. Row 1: Sign in as admin\n2. Row 2: Sign in as viewer");
  });

  it("CSV starts with a byte order mark so Excel reads accents", () => {
    const csv = csvFile(qaseTable([login]));
    expect(csv.startsWith("\uFEFFtitle,suite")).toBe(true);
    expect(csv).toContain("Type £ and é");
  });

  it("names the file after the place, the tool and the day", () => {
    const when = new Date("2026-11-07T02:00:00Z");
    expect(exportFileName("Web", "qase", when, "America/Los_Angeles")).toBe("Web cases - Qase - Nov 6 2026.csv");
    expect(exportFileName("A/B", "sheet", when, "Europe/London")).toBe("A B cases - Spreadsheet - Nov 7 2026.xlsx");
  });
});
