import { describe, expect, it } from "vitest";
import { fillChecks, rollUp, stepChecks } from "./step-checks";

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
