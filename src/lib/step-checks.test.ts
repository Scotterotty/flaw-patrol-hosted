import { describe, expect, it } from "vitest";
import { fillChecks, headingRows, isSectionTitle, readSteps, rollUp, saysNoExpected, stepChecks, withoutHeadings } from "./step-checks";
import { resultSteps } from "./result-steps";

const shared = { id: "s", name: "Comments", version: 1 };
const step = (action: string, expected = "") => ({ action, expected, shared });

describe("stepChecks", () => {
  it("leaves steps that aren't from a shared step alone", () => {
    expect(stepChecks({ action: "Name\nOne.\nTwo.", expected: "" })).toBeNull();
  });

  it("reads each line after the name as a check, with short lines as labels", () => {
    const r = stepChecks(step("Add Comments\nComment Subject\nThe subject can contain letters.\nThe subject can contain numbers.\nComment Message\nThe message can contain letters."));
    expect(r).toEqual({
      kind: "checks",
      title: "Add Comments",
      lines: [
        { label: "Comment Subject" },
        { text: "The subject can contain letters." },
        { text: "The subject can contain numbers." },
        { label: "Comment Message" },
        { text: "The message can contain letters." },
      ],
      count: 3,
      expected: "",
      notOn: [],
    });
  });

  it("keeps a colon line's list as one check and turns platform lines into tags", () => {
    const r = stepChecks(step("Asset Packs\nA user can add Asset Pack assets to a Space.\nThe available asset colours are:\nWhite\nRed\nBlue", "Not Supported by: UNREAL / UNITY"));
    expect(r?.kind === "checks" && r.lines).toEqual([{ text: "A user can add Asset Pack assets to a Space." }, { text: "The available asset colours are: White, Red, Blue" }]);
    expect(r?.kind === "checks" && r.notOn).toEqual(["UNREAL", "UNITY"]);
  });

  it("splits a platform line that runs into a sentence", () => {
    const r = stepChecks(step("SSO\nSign in with Apple.\nSign in with Google.", "Not supported by: UNREAL\nUser lands on the spaces list"));
    expect(r?.kind === "checks" && [r.notOn, r.expected]).toEqual([["UNREAL"], "User lands on the spaces list"]);
  });

  it("uses the Expected lines when the step is only a name", () => {
    const r = stepChecks(step("Hotspots", "A hotspot can be added.\nA hotspot can be removed."));
    expect(r?.kind === "checks" && [r.count, r.expected]).toEqual([2, ""]);
  });

  it("reads all-caps rows, and a short title-case first row, as headings", () => {
    expect(stepChecks(step("SEARCH BAR SHARED STEPS"))).toEqual({ kind: "heading", text: "SEARCH BAR SHARED STEPS" });
    expect(stepChecks(step("Space Lists"), true)).toEqual({ kind: "heading", text: "Space Lists" });
    expect(stepChecks(step("Open the app"), true)).toBeNull();
    expect(stepChecks(step("Space Lists"), false)).toBeNull();
  });

  it("works like before for a step with one check", () => {
    expect(stepChecks(step("Enter a Space\nA user can enter a Space without issue."))).toBeNull();
  });
});

describe("rollUp and fillChecks", () => {
  it("fails on any failure and passes only when every check is done", () => {
    expect(rollUp(["PASSED", "FAILED", "UNTESTED"])).toBe("FAILED");
    expect(rollUp(["PASSED", "UNTESTED"])).toBe("UNTESTED");
    expect(rollUp(["PASSED", "SKIPPED"])).toBe("PASSED");
    expect(rollUp(["SKIPPED", "SKIPPED"])).toBe("SKIPPED");
  });
  it("fills empty checks first, then sets them all", () => {
    expect(fillChecks(["FAILED", "UNTESTED"], "PASSED")).toEqual(["FAILED", "PASSED"]);
    expect(fillChecks(["FAILED", "PASSED"], "PASSED")).toEqual(["PASSED", "PASSED"]);
    expect(fillChecks(["FAILED", "PASSED"], "UNTESTED")).toEqual(["UNTESTED", "UNTESTED"]);
  });
});

// Heading rows are never counted as steps, and real steps always are.
describe("headingRows", () => {
  const entering = { id: "e", name: "ENTERING SPACES", version: 1 };
  const assets = { id: "a", name: "ASSETS PANEL", version: 1 };
  // Like TCT-3 "Hub - Entering Spaces": a heading row, then four real steps.
  const tct3 = [
    { number: "1.1", action: "ENTERING SPACES", expected: "", shared: entering },
    { number: "1.2", action: "Enter a Space\nA user can enter a Space without issue.", expected: "–", shared: entering },
    { number: "1.3", action: "Owned By You\nA user can enter a Space they own.", expected: "User can enter space", shared: entering },
    { number: "1.4", action: "Shared With You\nA user can enter a Space they have been invited to.", expected: "User can enter space", shared: entering },
    { number: "1.5", action: "Discover / Featured Space\nA user can enter a featured Space.", expected: "User can enter space", shared: entering },
  ];

  it("finds the heading row of a shared step and nothing else", () => {
    expect([...headingRows(tct3)]).toEqual([0]);
  });

  it("finds a second shared step's heading in the middle of a case", () => {
    const steps = [
      { number: "1", action: "Open the hub.", expected: "The hub opens." },
      { number: "2.1", action: "Assets Panel", expected: "", shared: assets },
      { number: "2.2", action: "Open the panel.", expected: "It opens.", shared: assets },
      { number: "3.1", action: "ENTERING SPACES", expected: "", shared: entering },
      { number: "3.2", action: "Enter a Space.", expected: "It opens.", shared: entering },
    ];
    expect([...headingRows(steps)]).toEqual([1, 3]);
  });

  it("never treats a real step as a heading", () => {
    const steps = [
      // Not from a shared step: a short instruction with no expected result still takes a result.
      { number: "1", action: "Open Settings", expected: "" },
      { number: "2", action: "Type koala", expected: "" },
      // From a shared step but with an Expected, or ending in a full stop, or a short line that doesn't open the shared step.
      { number: "3.1", action: "LOG IN", expected: "You are signed in.", shared: entering },
      { number: "3.2", action: "Press Enter.", expected: "", shared: entering },
      { number: "3.3", action: "Owned By You", expected: "", shared: entering },
    ];
    expect(headingRows(steps).size).toBe(0);
  });

  it("treats a step with nothing to check as a section title", () => {
    const steps = [
      { number: "", action: "SIGN IN / OUT STEPS", expected: "–" },
      { number: "1", action: "Sign in with a valid account.", expected: "The home page opens." },
      { number: "", action: "CHECK THE LOGO", expected: "" },
      { number: "", action: "Account settings", expected: "N/A" },
      { number: "2", action: "Change your name and save.", expected: "The new name shows." },
    ];
    expect([...headingRows(steps)]).toEqual([0, 2, 3]);
    expect(readSteps(steps)[0]).toEqual({ kind: "heading", text: "SIGN IN / OUT STEPS" });
  });

  it("keeps a section title only when a step with an expected result comes after it", () => {
    // The last step, and a plain checklist with no expected results, stay steps.
    expect(headingRows([{ number: "1", action: "Open the app", expected: "It opens" }, { number: "2", action: "CLOSE THE APP", expected: "-" }]).size).toBe(0);
    expect(headingRows([{ number: "1", action: "LOG IN", expected: "" }, { number: "2", action: "LOG OUT", expected: "" }]).size).toBe(0);
    // Test data: a title needs a checked step in its own row.
    const rows = [
      { number: "", action: "SEARCH", expected: "-", row: 0 },
      { number: "1", action: "Search for a.", expected: "Results show.", row: 0 },
      { number: "", action: "SEARCH", expected: "-", row: 1 },
    ];
    expect([...headingRows(rows)]).toEqual([0]);
  });

  it("keeps sentences, several lines and a real Expected as steps", () => {
    expect(isSectionTitle([{ action: "Click Save.", expected: "-" }, { action: "x", expected: "y" }], 0)).toBe(false);
    expect(isSectionTitle([{ action: "LOG IN\nWITH SSO", expected: "" }, { action: "x", expected: "y" }], 0)).toBe(false);
    expect(isSectionTitle([{ action: "LOG IN", expected: "You are in" }, { action: "x", expected: "y" }], 0)).toBe(false);
    expect(saysNoExpected(" — ")).toBe(true);
    expect(saysNoExpected("n/a")).toBe(true);
    expect(saysNoExpected("None shown")).toBe(false);
  });

  it("copes with missing or odd saved steps", () => {
    expect(headingRows(null).size).toBe(0);
    expect(headingRows("x").size).toBe(0);
    expect(headingRows([null, { action: 3 }]).size).toBe(0);
  });

  it("leaves heading rows out of step results, and keeps every real step", () => {
    const saved = ["UNTESTED", "PASSED", "PASSED", "PASSED", "PASSED"].map((status) => ({ status, actual: "" }));
    expect(withoutHeadings(tct3, saved)).toHaveLength(4);
    expect(resultSteps(saved, tct3)).toEqual(["PASSED", "PASSED", "PASSED", "PASSED"]);
    // A real step left untested still shows as an unlit pip.
    const half = ["UNTESTED", "PASSED", "UNTESTED", "PASSED", "PASSED"].map((status) => ({ status, actual: "" }));
    expect(resultSteps(half, tct3)).toEqual(["PASSED", "UNTESTED", "PASSED", "PASSED"]);
    // Cases without shared steps are untouched.
    expect(resultSteps(saved, [])).toHaveLength(5);
  });
});
