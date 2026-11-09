import { describe, expect, it } from "vitest";
import { colLetter, describeFill, fillConfigSchema, findLayout, matchEntries, planCells, sheetName, sheetWord, type FillEntry, type SheetGrid } from "./sheet-fill";

const pad = (row: string[], n = 11) => [...row, ...Array(Math.max(0, n - row.length)).fill("")];

// Like the Demo Dry Run checklist: run info on top, header on row 5, a section row, three runs of columns side by side.
function checklist(): SheetGrid {
  const values = [
    ["", "Run Status", "In progress"],
    ["", "Tester", "Priya"],
    ["", "Release", "RC 22"],
    [],
    ["", "Test", "Result", "Bug Ticket", "Summary", "Repro", "Result", "Bug Ticket", "Summary", "Repro"],
    ["", "Frida Demo Space"],
    ["", "User is able to login to all clients on the appropriate environment\n- Web\n- Unreal", "Pass"],
    ["", "Viewer Avatar – Generic", "Pass"],
    ["", "Site Model (Mag Office US)", "Fail", "CSP-1", "Dark"],
    ["", "Existing Assets (Web)", "Pass", "", "", "", "Skip, web build late"],
  ].map((r) => pad(r));
  return { values, lists: Array(11).fill(null) };
}

const entry = (id: string, title: string, status: FillEntry["status"], more: Partial<FillEntry> = {}): FillEntry => ({
  id,
  keys: [],
  title,
  status,
  tester: "Scott",
  steps: [],
  bugs: [],
  note: "",
  ...more,
});

describe("findLayout", () => {
  it("finds a header below run info rows and one column set per run", () => {
    const layout = findLayout(checklist())!;
    expect(layout.headerRow).toBe(5);
    expect(layout.titleCol).toBe(2);
    expect(layout.steps).toBe(false);
    expect(layout.sets).toHaveLength(2);
    expect(layout.sets[1]).toEqual({ label: "Columns G to I", cols: { result: 7, bug: 8, summary: 9 } });
  });

  it("reads Flaw Patrol's own cycle layout: case status under the % header, Status per step", () => {
    const grid: SheetGrid = {
      values: [
        ["Key", "Name", "Description", "Precondition", "Step Order", "Step Description", "Expected Result", "58.70%", "Executed By", "Status", "Defects", "Priority", "Folder"],
        ["PQ-1708", "[WEB] - AR - Holdouts", "", "", "1.1", "a", "", "Untested", "—", "Untested", "", "", ""],
        ["", "", "", "", "1.2", "b", "", "", "", "Untested", "", "", ""],
        ["PQ-1744", "[WEB] - Play Mode", "", "", "1.1", "c", "", "Untested", "—", "Untested", "", "", ""],
      ],
      lists: [null, null, null, null, null, null, null, ["Untested", "In Progress", "Passed", "Failed", "Blocked", "Not Run"], ["—", "Scott"], ["Untested", "Passed", "Failed"], null, null, null],
    };
    const layout = findLayout(grid)!;
    expect(layout).toMatchObject({ headerRow: 1, keyCol: 1, stepCol: 5, steps: true });
    expect(layout.sets[0].cols).toEqual({ result: 8, executedBy: 9, stepStatus: 10, bug: 11 });

    const e = entry("a", "Holdouts renamed", "FAILED", {
      keys: ["PQ-1708"],
      steps: [
        { number: "1.1", status: "PASSED" },
        { number: "1.2", status: "FAILED" },
      ],
      bugs: [{ key: "CSP-9", url: "https://jira/CSP-9", title: "Broken" }],
    });
    const u = entry("b", "[WEB] - Play Mode", "UNTESTED", { keys: ["X-1"], steps: [{ number: "1.1", status: "UNTESTED" }] });
    const match = matchEntries(grid, layout, [e, u]);
    expect([...match.rows]).toEqual([
      ["a", 2],
      ["b", 4],
    ]);
    const cells = planCells(grid, layout, fillConfigSchema.parse({}), [e, u], match);
    expect(cells).toContainEqual({ r: 2, c: 8, v: "Failed" });
    expect(cells).toContainEqual({ r: 2, c: 9, v: "Scott" });
    expect(cells).toContainEqual({ r: 3, c: 10, v: "Failed" });
    expect(cells).toContainEqual({ r: 2, c: 11, v: "CSP-9", links: [{ text: "CSP-9", url: "https://jira/CSP-9" }] });
    // Untested keeps the sheet's own words.
    expect(cells).toContainEqual({ r: 4, c: 8, v: "Untested" });
    expect(cells).toContainEqual({ r: 4, c: 9, v: "—" });
    expect(describeFill(layout, fillConfigSchema.parse({}))).toBe("Result, Executed By, Step Status and Bug Ticket");
  });

  it("uses a header row someone picked, and says no when it isn't one", () => {
    expect(findLayout(checklist(), 5)?.headerRow).toBe(5);
    expect(findLayout(checklist(), 2)).toBeNull();
    expect(findLayout({ values: [["a", "b"]], lists: [] })).toBeNull();
  });
});

describe("matchEntries", () => {
  it("matches titles loosely, by first line and by start, and lists the rest", () => {
    const grid = checklist();
    const layout = findLayout(grid)!;
    const entries = [
      entry("1", "User is able to login to all clients on the appropriate environment", "PASSED"),
      entry("2", "Viewer Avatar - Generic", "PASSED"),
      entry("3", "Site Model", "FAILED"),
      entry("4", "Something new", "PASSED"),
    ];
    const m = matchEntries(grid, layout, entries);
    expect(m.rows.get("1")).toBe(7);
    expect(m.rows.get("2")).toBe(8);
    expect(m.rows.get("3")).toBe(9); // "Site Model (Mag Office US)" starts with the title
    expect(m.unmatched).toEqual(["4"]);
    expect(m.free.map((f) => f.row)).toEqual([6, 10]);

    const picked = matchEntries(grid, layout, entries, { "4": 10, "3": 0 });
    expect(picked.rows.get("4")).toBe(10);
    expect(picked.skipped).toEqual(["3"]);
    expect(picked.unmatched).toEqual([]);
  });
});

describe("planCells", () => {
  it("fills only the picked set and columns, in the sheet's words", () => {
    const grid = checklist();
    const layout = findLayout(grid)!;
    const entries = [
      entry("1", "User is able to login to all clients on the appropriate environment", "PASSED"),
      entry("2", "Viewer Avatar - Generic", "BLOCKED", { note: "No iPad on site" }),
      entry("3", "Site Model", "FAILED", { bugs: [{ key: "CSP-4521", url: null, title: "Stuck loading" }] }),
      entry("4", "Existing Assets (Web)", "UNTESTED"),
    ];
    const config = fillConfigSchema.parse({ set: 1, roles: ["result", "bug", "summary"] });
    const cells = planCells(grid, layout, config, entries, matchEntries(grid, layout, entries));
    expect(cells.every((c) => c.c >= 7 && c.c <= 9)).toBe(true);
    expect(cells).toContainEqual({ r: 7, c: 7, v: "Pass" });
    expect(cells).toContainEqual({ r: 8, c: 7, v: "Blocked" });
    expect(cells).toContainEqual({ r: 8, c: 9, v: "No iPad on site" });
    expect(cells).toContainEqual({ r: 9, c: 7, v: "Fail" });
    expect(cells).toContainEqual({ r: 9, c: 8, v: "CSP-4521" });
    expect(cells).toContainEqual({ r: 9, c: 9, v: "Stuck loading" });
    expect(cells).toContainEqual({ r: 10, c: 7, v: "" }); // untested: blank, and the script keeps the typed note there

    const onlyResult = planCells(grid, layout, fillConfigSchema.parse({ set: 1, roles: ["result"] }), entries, matchEntries(grid, layout, entries));
    expect(onlyResult.every((c) => c.c === 7)).toBe(true);
  });

  it("never sends a formula", () => {
    const grid = checklist();
    const layout = findLayout(grid)!;
    const e = [entry("1", "Viewer Avatar - Generic", "FAILED", { note: "=HYPERLINK(1)" })];
    const cells = planCells(grid, layout, fillConfigSchema.parse({ roles: ["summary"] }), e, matchEntries(grid, layout, e));
    expect(cells[0].v).toBe("'=HYPERLINK(1)");
  });
});

describe("words and letters", () => {
  it("picks the sheet's spelling, with cycle-sheet words as the fallback", () => {
    expect(sheetWord("PASSED", ["Pass", "Fail"])).toBe("Pass");
    expect(sheetWord("SKIPPED", [])).toBe("Not Run");
    expect(sheetWord("UNTESTED", ["Pass"])).toBe("");
    expect(sheetWord("IN_PROGRESS", ["In Progress"])).toBe("In Progress");
  });
  it("names columns like Sheets does", () => {
    expect([1, 26, 27, 52].map(colLetter)).toEqual(["A", "Z", "AA", "AZ"]);
  });
});

describe("sheetName", () => {
  const list = ["—", "Scott", "Ryan", "Katie Lafaw", "Jord"];
  it("uses the sheet's own spelling of a tester's name", () => {
    expect(sheetName("Scott Smith", list)).toBe("Scott");
    expect(sheetName("scott", list)).toBe("Scott");
    expect(sheetName("Katie", list)).toBe("Katie Lafaw");
    expect(sheetName("Katie Lafaw", ["katie lafaw"])).toBe("katie lafaw");
    expect(sheetName("Scott Smith", ["Scott S.", "Scott J."])).toBe("Scott S.");
  });
  it("keeps the name when the sheet has no match, or more than one", () => {
    expect(sheetName("Priya Patel", list)).toBe("Priya Patel");
    expect(sheetName("Katie Jones", list)).toBe("Katie Jones");
    expect(sheetName("Scott", ["Scott S.", "Scott J."])).toBe("Scott");
  });
});
