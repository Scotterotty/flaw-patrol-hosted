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

  it("Qase: suite rows first, then one row per case in Qase's current format", () => {
    const t = qaseTable([login, bare, nested]);
    expect(t.header.slice(0, 2)).toEqual(["v2.id", "title"]);
    expect(t.header).toHaveLength(26);
    const col = (r: number, h: string) => t.rows[r][t.header.indexOf(h)];
    // Web, Web/Login, Web/Login/SSO as suites, then the three cases.
    expect(t.rows).toHaveLength(6);
    expect([0, 1, 2].map((r) => [col(r, "suite_id"), col(r, "suite_parent_id"), col(r, "suite"), col(r, "suite_without_cases")])).toEqual([
      [1, "", "Web", 1],
      [2, 1, "Login", 1],
      [3, 2, "SSO", 1],
    ]);
    expect(t.starts).toEqual([3, 4, 5]);
    expect(col(3, "title")).toBe("Sign in with email");
    expect(col(3, "steps_actions")).toBe('1. "Open the sign-in page"\n2. "Type \\u00a3 and \\u00e9"\n');
    expect(col(3, "steps_result")).toBe('1. "The form shows"\n2. "Signed in"\n');
    expect(col(3, "steps_data")).toBe('1. ""\n2. ""\n');
    expect([col(3, "suite_id"), col(3, "suite_parent_id"), col(3, "suite"), col(3, "suite_without_cases")]).toEqual([2, 1, "Login", ""]);
    expect(col(3, "priority")).toBe("high");
    expect(col(3, "automation")).toBe("is-not-automated");
    expect(col(3, "tags")).toBe("Web,Smoke");
    expect(col(4, "priority")).toBe("high");
    expect(col(4, "severity")).toBe("critical");
    expect(col(4, "automation")).toBe("automated");
    expect(col(4, "suite_id")).toBe("");
    expect(col(4, "steps_actions")).toBe("");
    expect(col(5, "suite_id")).toBe(3);
  });

  it("Qase steps escape quotes, slashes and line breaks the way Qase does", () => {
    const t = qaseTable([{ ...login, folder: [], steps: [{ number: "1", action: 'Press "Save" / Close\nThen wait', expected: "" }] }]);
    expect(t.rows[0][t.header.indexOf("steps_actions")]).toBe('1. "Press \\"Save\\" \\/ Close\\nThen wait"\n');
  });

  it("test data rows are named in the steps", () => {
    const t = qaseTable([{ ...login, folder: [], steps: [{ number: "1", action: "Sign in as admin", expected: "", row: 0 }, { number: "1", action: "Sign in as viewer", expected: "", row: 1 }] }]);
    expect(t.rows[0][t.header.indexOf("steps_actions")]).toBe('1. "Row 1: Sign in as admin"\n2. "Row 2: Sign in as viewer"\n');
  });

  it("Qase CSV has no byte order mark and plain line breaks; others keep the mark", () => {
    const csv = csvFile(qaseTable([login]), "qase");
    expect(csv.startsWith("v2.id,title,")).toBe(true);
    expect(csv).not.toContain("\r\n");
    expect(csv).toContain(',"1. ""Open the sign-in page""\n2. ""Type \\u00a3 and \\u00e9""\n",');
    expect(csvFile(testrailTable([login]), "testrail").startsWith("\uFEFFID,Title")).toBe(true);
  });

  it("names the file after the place, the tool and the day", () => {
    const when = new Date("2026-11-07T02:00:00Z");
    expect(exportFileName("Web", "qase", when, "America/Los_Angeles")).toBe("Web cases - Qase - Nov 6 2026.csv");
    expect(exportFileName("A/B", "sheet", when, "Europe/London")).toBe("A B cases - Spreadsheet - Nov 7 2026.xlsx");
  });
});
