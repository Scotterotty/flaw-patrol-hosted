import { describe, expect, it } from "vitest";
import {
  detectSource,
  guessMapping,
  htmlToText,
  numberedSteps,
  pairSteps,
  parsePriority,
  restoreLineBreaks,
  rowsToCases,
  packedSteps,
  splitPackedStep,
  splitStepCell,
} from "./csv-import";

describe("splitStepCell", () => {
  it("splits numbered lists and joins wrapped lines", () => {
    expect(splitStepCell("1. Open the app\n2) Click Login\n   with the admin user\n3 - Submit")).toEqual([
      "Open the app",
      "Click Login\nwith the admin user",
      "Submit",
    ]);
  });
  it("treats each line as a step when nothing is numbered", () => {
    expect(splitStepCell("Open\r\n\r\nClose")).toEqual(["Open", "Close"]);
  });
  it("returns nothing for an empty cell", () => {
    expect(splitStepCell("  ")).toEqual([]);
  });
});

describe("pairSteps", () => {
  it("pairs by position and keeps extra expected text on the last step", () => {
    expect(pairSteps(["a", "b"], ["x", "y", "z"])).toEqual([
      { action: "a", expected: "x" },
      { action: "b", expected: "y\nz" },
    ]);
  });
});

describe("parsePriority", () => {
  it("understands common tool vocabularies", () => {
    expect(parsePriority("Blocker")).toBe("CRITICAL");
    expect(parsePriority("P1")).toBe("HIGH");
    expect(parsePriority("")).toBe("MEDIUM");
    expect(parsePriority("minor")).toBe("LOW");
    expect(parsePriority("whenever")).toBeNull();
  });
});

describe("rowsToCases", () => {
  it("reads one-row-per-case and one-row-per-step layouts", () => {
    const rows = [
      ["Title", "Section", "Priority", "Labels", "Steps", "Expected Result"],
      ["Login works", "Auth / Login", "High", "smoke, auth", "1. Open\n2. Sign in", "1. Page loads\n2. Dashboard shows"],
      ["Logout works", "Auth", "", "", "Click logout", "Signed out"],
      ["", "", "", "", "Reload", "Still signed out"],
      ["", "", "", "", "", ""],
    ];
    const mapping = guessMapping(rows[0]);
    expect(mapping).toMatchObject({ title: 0, folder: 1, priority: 2, tags: 3, steps: 4, expected: 5 });
    const { cases, warnings } = rowsToCases(rows, mapping);
    expect(warnings).toEqual([]);
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({
      title: "Login works",
      folderPath: ["Auth", "Login"],
      priority: "HIGH",
      tags: ["smoke", "auth"],
      steps: [
        { action: "Open", expected: "Page loads" },
        { action: "Sign in", expected: "Dashboard shows" },
      ],
    });
    expect(cases[1].steps).toEqual([
      { action: "Click logout", expected: "Signed out" },
      { action: "Reload", expected: "Still signed out" },
    ]);
  });

  it("warns about bad priorities and orphan steps", () => {
    const rows = [
      ["Title", "Steps", "Priority"],
      ["", "orphan", ""],
      ["Case", "do it", "someday"],
    ];
    const { cases, warnings } = rowsToCases(rows, { title: 0, steps: 1, priority: 2 });
    expect(cases).toHaveLength(1);
    expect(cases[0].priority).toBe("MEDIUM");
    expect(warnings).toHaveLength(2);
  });

  it("marks cases with an automation ID as automated", () => {
    const { cases } = rowsToCases([["Title", "Automation ID"], ["API health", "api.health"]], { title: 0, automationId: 1 });
    expect(cases[0]).toMatchObject({ type: "AUTOMATED", automationId: "api.health" });
  });
});

describe("qTest exports", () => {
  it("groups step rows that repeat the case ID", () => {
    const rows = [
      ["Id", "Name", "Precondition", "Module", "Priority", "Test Step #", "Test Step Description", "Test Step Expected Result"],
      ["TC-1", "Login", "User exists", "MD-1 Auth", "High", "1", "Open login", "Form shows"],
      ["TC-1", "Login", "User exists", "MD-1 Auth", "High", "2", "Submit", "Signed in"],
      ["TC-2", "Logout", "", "MD-1 Auth", "Low", "1", "Click logout", "Signed out"],
    ];
    const mapping = guessMapping(rows[0]);
    expect(mapping).toMatchObject({ sourceId: 0, title: 1, preconditions: 2, folder: 3, priority: 4, steps: 6, expected: 7 });
    const { cases, warnings } = rowsToCases(rows, mapping);
    expect(warnings).toEqual([]);
    expect(cases.map((c) => [c.title, c.steps.length])).toEqual([
      ["Login", 2],
      ["Logout", 1],
    ]);
    expect(cases[0].steps[1]).toEqual({ action: "Submit", expected: "Signed in" });
  });
});

describe("tool exports", () => {
  it("matches a qTest export column for column", () => {
    const rows = [
      ["Id", "Name", "Description", "Precondition", "Test Step #", "Test Step Description", "Test Step Expected Result", "Module", "Status", "Type", "Priority", "Requirement Ids"],
      ["TC-12", "Pay with saved card", "<p>Card on file</p>", "<p>Signed in</p>", "1", "<p>Open the cart</p>", "<p>2 items&nbsp;listed</p>", "MD-3 Web/MD-7 Checkout", "Ready", "Manual", "Urgent", "RQ-4, RQ-9"],
      ["TC-12", "Pay with saved card", "", "", "2", "Click <b>Pay</b><br/>then confirm", "Order placed", "MD-3 Web/MD-7 Checkout", "", "", "", ""],
      ["TC-13", "API health", "", "", "1", "GET /health", "200 OK", "MD-3 Web", "Ready", "Automation", "Low", ""],
    ];
    expect(detectSource(rows[0])).toBe("qtest");
    const mapping = guessMapping(rows[0], "qtest");
    expect(mapping).toMatchObject({ sourceId: 0, title: 1, description: 2, preconditions: 3, steps: 5, expected: 6, folder: 7, type: 9, priority: 10, requirements: 11 });
    const { cases, warnings } = rowsToCases(rows, mapping, "qtest");
    expect(warnings).toEqual([]);
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({
      title: "Pay with saved card",
      folderPath: ["Web", "Checkout"],
      priority: "CRITICAL",
      tags: [],
      stories: ["RQ-4", "RQ-9"],
      preconditions: "Card on file\n\nPreconditions:\nSigned in",
      sourceId: "TC-12",
      steps: [
        { action: "Open the cart", expected: "2 items listed" },
        { action: "Click Pay\nthen confirm", expected: "Order placed" },
      ],
    });
    expect(cases[1]).toMatchObject({ title: "API health", type: "AUTOMATED", folderPath: ["Web"] });
  });

  it("recognizes other tools from their headers", () => {
    expect(detectSource(["Key", "Name", "Folder", "Test Script (Step-by-Step) - Step"])).toBe("zephyr");
    expect(detectSource(["Issue key", "Summary", "Action", "Data", "Expected Result"])).toBe("xray");
    expect(detectSource(["ID", "Title", "Section Hierarchy", "Steps (Step)"])).toBe("testrail");
    expect(detectSource(["Title", "Steps"])).toBe("other");
  });

  it("adds Xray test data to its step", () => {
    const rows = [
      ["Issue key", "Summary", "Action", "Data", "Expected Result"],
      ["QA-1", "Search", "Type a term", "shoes", "Results show"],
    ];
    const { cases } = rowsToCases(rows, guessMapping(rows[0], "xray"), "xray");
    expect(cases[0].steps).toEqual([{ action: "Type a term\nTest data: shoes", expected: "Results show" }]);
  });

  it("turns rich text into plain lines", () => {
    expect(htmlToText("<ul><li>One</li><li>Two &amp; three</li></ul>")).toBe("- One\n- Two & three");
    expect(htmlToText("Return to the Hub &gt; Spaces page &amp; wait")).toBe("Return to the Hub > Spaces page & wait");
    expect(htmlToText("R&D &copy; stays")).toBe("R&D &copy; stays");
    expect(htmlToText("a < b")).toBe("a < b");
  });
});

// Shape of qTest's test run export from Test Execution: the key only on a case's
// first row, steps numbered 1.1, 2.1 by called test case, line breaks dropped.
describe("qTest test run export", () => {
  const header = ["Key", "Name", "Description", "Precondition", "Step Order", "Step Description", "Expected Result", "0.00%", "Executed By", "Status", "Actual Result", "Defects", "Priority", "Folder"];
  const row = (key: string, name: string, order: string, step: string, expected: string, priority = "", folder = "") =>
    [key, name, "", "", order, step, expected, "", "", "Untested", "", "", priority, folder];
  const rows = [
    header,
    row("PQ-1", "[WEB] - Login", "1.1", "LOGIN UNIQUE STEPS", "", "Blocker", "2026 Cases/WEB"),
    row("", "", "1.2", "Sign inA user can sign in.A user can sign out.", "Not supported by: MOBILE WEBUser sees the home page"),
    row("", "", "2.1", "SEARCH BAR SHARED STEPS", ""),
    row("", "", "2.2", "Search Bar InteractionWhen a user clicks the search bar, it is highlighted.", ""),
    row("PQ-2", "[WEB] - Assets", "1.1", "Upload Asset", "Asset appears", "Not Prioritized", "2026 Cases/WEB"),
    row("", "", "2.1", "SEARCH BAR SHARED STEPS", ""),
    row("", "", "2.2", "Search Bar InteractionWhen a user clicks the search bar, it is highlighted.", ""),
  ];

  it("maps the columns and recognizes qTest", () => {
    expect(detectSource(header)).toBe("qtest");
    const m = guessMapping(header, "qtest");
    expect([m.sourceId, m.title, m.folder, m.stepOrder, m.steps, m.expected, m.priority].map((i) => header[i!])).toEqual([
      "Key",
      "Name",
      "Folder",
      "Step Order",
      "Step Description",
      "Expected Result",
      "Priority",
    ]);
  });

  it("keeps cases, folders and keys, and turns blocks two cases share into one shared step", () => {
    const { cases, shared, warnings } = rowsToCases(rows, guessMapping(header, "qtest"), "qtest", { restoreBreaks: true });
    expect(warnings).toEqual([]);
    expect(cases.map((c) => [c.sourceId, c.title, c.folderPath.join("/"), c.priority])).toEqual([
      ["PQ-1", "[WEB] - Login", "2026 Cases/WEB", "CRITICAL"],
      ["PQ-2", "[WEB] - Assets", "2026 Cases/WEB", "MEDIUM"],
    ]);
    expect(shared.map((s) => [s.name, s.steps.length])).toEqual([["SEARCH BAR SHARED STEPS", 2]]);
    expect(numberedSteps(cases[0], shared).map((s) => [s.number, s.action.split("\n")[0], s.sharedName ?? ""])).toEqual([
      // A line in capitals with nothing to check is a section title: no number, the steps under it count on.
      ["", "LOGIN UNIQUE STEPS", ""],
      ["1", "Sign in", ""],
      ["2.1", "SEARCH BAR SHARED STEPS", "SEARCH BAR SHARED STEPS"],
      ["2.2", "Search Bar Interaction", "SEARCH BAR SHARED STEPS"],
    ]);
    expect(cases[0].steps[1]).toEqual({ action: "Sign in\nA user can sign in.\nA user can sign out.", expected: "Not supported by: MOBILE WEB\nUser sees the home page" });
    expect(cases[1].items.map((i) => i.kind)).toEqual(["step", "shared"]);
  });

  it("leaves the text alone when line breaks aren't restored", () => {
    const { cases } = rowsToCases(rows, guessMapping(header, "qtest"), "qtest");
    expect(cases[0].steps[1].action).toBe("Sign inA user can sign in.A user can sign out.");
  });
});

describe("restoreLineBreaks", () => {
  it("splits run-together lines but keeps camel-case names", () => {
    expect(restoreLineBreaks("Owned By YouA user can enter.The Space opens")).toBe("Owned By You\nA user can enter.\nThe Space opens");
    expect(restoreLineBreaks("Holdout TogglingAR toggle is ON")).toBe("Holdout Toggling\nAR toggle is ON");
    expect(restoreLineBreaks("Not supported by: UNITYClicking opens it")).toBe("Not supported by: UNITY\nClicking opens it");
    expect(restoreLineBreaks("Works on iPhone with WebGL and GitHub")).toBe("Works on iPhone with WebGL and GitHub");
    expect(restoreLineBreaks("Already\nsplit")).toBe("Already\nsplit");
  });
});

describe("rows without a case ID", () => {
  const header = ["Key", "Name", "Folder", "Step Order", "Step Description", "Expected Result"];
  it("keeps a named row with no key as a step of the case above", () => {
    const rows = [
      header,
      ["PQ-1747", "[WEB] - Hub - Sidebar", "Cases/WEB", "1.1", "Open the hub", "Hub opens"],
      ["", "UPDATE", "", "1.2", "Open the sidebar", "Sidebar opens"],
      ["PQ-1747", "[WEB] - Hub - Sidebar", "Cases/WEB", "1.3", "Close it", "Closed"],
      ["PQ-1748", "Other", "Cases/WEB", "1", "Go", "Gone"],
    ];
    const { cases, warnings } = rowsToCases(rows, guessMapping(header, "qtest"), "qtest");
    expect(cases.map((c) => [c.sourceId, c.steps.length])).toEqual([
      ["PQ-1747", 3],
      ["PQ-1748", 1],
    ]);
    expect(warnings).toEqual([
      {
        row: 3,
        lead: "PQ-1747 [WEB] - Hub - Sidebar",
        text: 'got an extra step from a row with no Key. That row (row 3 in your file) had "UPDATE" in the Name column, so it was treated as a step, not a new case.',
        caseRow: 2,
        step: 1,
        chip: "From row 3, no Key",
      },
    ]);
  });

  it("finds folder names with a spaced slash and can keep them whole", async () => {
    const { spacedSlashNames, folderPreview } = await import("./csv-import");
    const rows = [header, ["PQ-1", "A", "2026 Cases/Shared / Unique Cases", "1", "x", "y"], ["PQ-2", "B", "2026 Cases/WEB", "1", "x", "y"]];
    const mapping = guessMapping(header, "qtest");
    expect(spacedSlashNames(rows, mapping)).toEqual(["Shared / Unique Cases"]);
    expect(rowsToCases(rows, mapping, "qtest").cases[0].folderPath).toEqual(["2026 Cases", "Shared", "Unique Cases"]);
    const kept = rowsToCases(rows, mapping, "qtest", { keepWhole: ["Shared / Unique Cases"] }).cases;
    expect(kept[0].folderPath).toEqual(["2026 Cases", "Shared - Unique Cases"]);
    expect(folderPreview(kept)).toEqual([
      { name: "2026 Cases", count: 0, children: [{ name: "Shared - Unique Cases", count: 1, children: [] }, { name: "WEB", count: 1, children: [] }] },
    ]);
  });
});

describe("Jira story column (ver_82)", () => {
  it("turns keys in a Requirements cell into story links and keeps other text as tags", () => {
    const rows = [
      ["Title", "Steps", "Requirements"],
      ["Join from invite", "Open link", "PRJ-12, prj-13 PRJ-14"],
      ["Old case", "Do it", "Legacy spec; PRJ-20"],
    ];
    const { cases } = rowsToCases(rows, guessMapping(rows[0]), "other");
    expect(cases[0].stories).toEqual(["PRJ-12", "PRJ-13", "PRJ-14"]);
    expect(cases[0].tags).toEqual([]);
    expect(cases[1].stories).toEqual(["PRJ-20"]);
    expect(cases[1].tags).toEqual(["Legacy spec"]);
  });
  it("maps a Story or Jira column", () => {
    expect(guessMapping(["Title", "Story"]).requirements).toBe(1);
    expect(guessMapping(["Title", "Jira key"]).requirements).toBe(1);
  });
});

describe("TestRail Type values (ver_91)", () => {
  it("keeps Type values other than Manual or Automated as type: tags", () => {
    const rows = [
      ["Title", "Type", "Tags"],
      ["Login works", "Functional", "smoke"],
      ["Bad password", "Negative", ""],
      ["Nightly", "Automated", ""],
      ["Plain", "Manual", ""],
    ];
    const { cases } = rowsToCases(rows, guessMapping(rows[0]));
    expect(cases.map((c) => c.tags)).toEqual([["smoke", "type: Functional"], ["type: Negative"], [], []]);
    expect(cases.map((c) => c.type)).toEqual(["MANUAL", "MANUAL", "AUTOMATED", "MANUAL"]);
  });
});

describe("steps with their expected results inside them (ver_135)", () => {
  const header = ["Key", "Name", "Step Order", "Step Description", "Expected Result"];
  const rows = [
    header,
    ["PQ-1", "Assets Panel", "1.1", "Toggle Multi-SelectA user is able to toggle multi-select on.A user is able to toggle multi-select off.", "Not Supported by: UNREAL / UNITY"],
    ["", "", "1.2", "Upload Asset", "A file uploads."],
    ["", "", "1.3", "Open the asset panel.Asset Panels.Panels don't freeze.", ""],
  ];
  const mapping = () => guessMapping(header, "qtest");

  it("keeps the first line as the step and moves the rest under the Expected text", () => {
    expect(splitPackedStep({ action: "Toggle Multi-Select\nA user can turn it on.\nA user can turn it off.", expected: "Not Supported by: UNITY" })).toEqual({
      action: "Toggle Multi-Select",
      expected: "Not Supported by: UNITY\nA user can turn it on.\nA user can turn it off.",
    });
    expect(splitPackedStep({ action: "Upload Asset", expected: "A file uploads." })).toEqual({ action: "Upload Asset", expected: "A file uploads." });
    expect(splitPackedStep({ action: "One.\nTwo.\nThree.", expected: "" }, 2)).toEqual({ action: "One.\nTwo.", expected: "Three." });
    expect(splitPackedStep({ action: "Log in\nYou see the hub.\nTest data: bob", expected: "" })).toEqual({ action: "Log in\nTest data: bob", expected: "You see the hub." });
  });

  it("moves lines only when asked, and keeps more lines where the preview asked", () => {
    const off = rowsToCases(rows, mapping(), "qtest", { restoreBreaks: true });
    expect(packedSteps(off.cases)).toEqual({ steps: 2, cases: 1 });
    expect(off.cases[0].steps[0].action).toContain("A user is able to toggle multi-select on.");

    const on = rowsToCases(rows, mapping(), "qtest", { restoreBreaks: true, moveExpected: true, keepLines: { "2:2": 2 } });
    expect(on.cases[0].steps).toEqual([
      { action: "Toggle Multi-Select", expected: "Not Supported by: UNREAL / UNITY\nA user is able to toggle multi-select on.\nA user is able to toggle multi-select off." },
      { action: "Upload Asset", expected: "A file uploads." },
      { action: "Open the asset panel.\nAsset Panels.", expected: "Panels don't freeze." },
    ]);
  });

  it("leaves files with one step per line alone", () => {
    const plain = [["Title", "Steps", "Expected"], ["Login", "Open login\nSubmit", "Form shows\nSigned in"]];
    const { cases } = rowsToCases(plain, guessMapping(plain[0]), "other", { moveExpected: true });
    expect(cases[0].steps).toEqual([
      { action: "Open login", expected: "Form shows" },
      { action: "Submit", expected: "Signed in" },
    ]);
  });
});

// ver_169: Scott's "Demo Dry Run Checklist" has run info on top, the column names on row 23,
// section rows ("Queen Mary Space") and multi-line titles.
import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { findHeaderRow, multiLineTitles, perRunColumns, runSheetRows, sheetResultCount, splitTitle } from "./csv-import";

const ddr = () =>
  Papa.parse<string[]>(readFileSync(new URL("../../tests/e2e/fixtures/demo-dry-run-checklist.csv", import.meta.url), "utf8"), { skipEmptyLines: false }).data.filter(
    (r, i, all) => i < all.length - 1 || r.some((c) => c.trim()),
  );

describe("header row below row 1", () => {
  it("finds the column names on row 23 and reads sections as top folders", () => {
    const rows = ddr();
    const h = findHeaderRow(rows);
    expect(h + 1).toBe(23);
    const mapping = guessMapping(rows[h], detectSource(rows[h]));
    expect(rows[h][mapping.title!]).toBe("Test Case");
    expect(rows[h][mapping.folder!]).toBe("Category");
    expect(mapping.expected).toBeUndefined();
    expect(perRunColumns(rows[h], mapping).map((i) => rows[h][i])).toEqual([
      "Result",
      "Bug Ticket",
      "Summary (note if new or existing bug)",
      "Repro in 2nd Space",
      "Repro in different back-end environment",
      "Repro in Dev/RC",
    ]);
    expect(multiLineTitles(rows, mapping, h)).toBeGreaterThan(10);

    const res = rowsToCases(rows, mapping, "other", { headerRow: h, firstLineTitle: true });
    expect(res.cases).toHaveLength(53);
    expect(res.sections.map((s) => s.name)).toEqual(["Frida Demo Space", "Queen Mary Space", "Pilot Space"]);
    expect(res.warnings).toEqual([]);
    expect(new Set(res.cases.map((c) => c.folderPath[0]))).toEqual(new Set(["Frida Demo Space", "Queen Mary Space", "Pilot Space"]));
    const avatar = res.cases.find((c) => c.title.startsWith("Viewer Avatar - Custom: User is able to upload"))!;
    // Same first line twice in a folder: each gets its next line too.
    expect(res.cases.filter((c) => c.title.startsWith("Viewer Avatar - Custom")).map((c) => c.title)).toEqual([
      "Viewer Avatar - Custom: User is able to upload and select a custom avatar on the Web.",
      "Viewer Avatar - Custom: Users appear as their uploaded custom avatar across all platforms.",
    ]);
    expect(res.cases.find((c) => c.title === "Gaussian Splat")).toBeTruthy();
    expect(avatar.folderPath).toEqual(["Frida Demo Space", "Avatar"]);
    expect(avatar.row).toBeGreaterThan(23);
    expect(avatar.steps).toEqual([{ action: "", expected: "User is able to upload and select a custom avatar on the Web." }]);
    // A one-line title stays whole, with no steps.
    const enter = res.cases.find((c) => c.title.startsWith("User is able to enter the Frida"))!;
    expect(enter.steps).toEqual([]);

    // Keeping whole titles puts every line in the title, as before.
    const whole = rowsToCases(rows, mapping, "other", { headerRow: h, firstLineTitle: false });
    expect(whole.cases.find((c) => c.row === avatar.row)!.title).toContain("\n");

    // No real results: "Select" and blanks don't count.
    expect(sheetResultCount(rows, h)).toBe(0);
    const filled = rows.map((r, i) => (i === avatar.row - 1 ? r.map((c, j) => (j === 3 ? "Pass" : c)) : r));
    expect(sheetResultCount(filled, h)).toBe(1);
    const handed = runSheetRows(filled, mapping, { headerRow: h, firstLineTitle: true });
    expect(handed[0][3]).toBe("Case result");
    expect(handed).toHaveLength(54);
    expect(handed.some((r) => r[mapping.title!] === avatar.title && r[3] === "Pass")).toBe(true);
  });

  it("leaves files with column names on row 1 as they were", () => {
    const rows = [
      ["Title", "Steps", "Expected"],
      ["Log in\nwith SSO", "Open app", "Signed in"],
      ["", "Click", "Done"],
    ];
    expect(findHeaderRow(rows)).toBe(0);
    const res = rowsToCases(rows, guessMapping(rows[0]), "other", { headerRow: 0, firstLineTitle: true });
    expect(res.cases.map((c) => c.title)).toEqual(["Log in\nwith SSO"]);
    expect(res.cases[0].steps).toHaveLength(2);
    expect(res.sections).toEqual([]);
  });

  it("passes over blank rows above row-1-style column names, and stays on the first row when nothing is known", () => {
    expect(findHeaderRow([[""], ["Title", "Foo"], ["A", "b"]])).toBe(1);
    expect(findHeaderRow([["Colour", "Thing"], ["a", "b"]])).toBe(0);
  });

  it("splits a title into its first line and the rest", () => {
    expect(splitTitle("\nOne\nTwo\n\nThree")).toEqual(["One", "Two\n\nThree"]);
    expect(splitTitle("Only")).toEqual(["Only", ""]);
  });
});
