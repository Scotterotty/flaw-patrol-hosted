import { describe, expect, it } from "vitest";
import { intoRunAction } from "./run-import";

// ver_166: a sheet added to a run in progress only fills untested cases.
describe("intoRunAction", () => {
  it("fills cases still untested here", () => {
    expect(intoRunAction("UNTESTED", false, "PASSED")).toBe("fill");
    expect(intoRunAction("UNTESTED", false, "IN_PROGRESS")).toBe("fill");
  });
  it("never clears anything for a blank or Select in the sheet", () => {
    expect(intoRunAction("PASSED", false, "UNTESTED")).toBe("blank");
    expect(intoRunAction("UNTESTED", false, "UNTESTED")).toBe("blank");
  });
  it("lists a different final result as a disagreement", () => {
    expect(intoRunAction("FAILED", false, "PASSED")).toBe("disagree");
    expect(intoRunAction("RETEST", false, "PASSED")).toBe("disagree");
  });
  it("skips cases already marked the same, or started here", () => {
    expect(intoRunAction("PASSED", false, "PASSED")).toBe("skip");
    expect(intoRunAction("IN_PROGRESS", true, "FAILED")).toBe("skip");
    expect(intoRunAction("UNTESTED", true, "FAILED")).toBe("skip");
    expect(intoRunAction("PASSED", false, "IN_PROGRESS")).toBe("skip");
  });
});

describe("readStatus", () => {
  it("reads an untouched Select dropdown as no result, not an unknown word", async () => {
    const { readStatus } = await import("./run-import");
    expect(readStatus("Select")).toEqual({ status: "UNTESTED", known: true });
  });
});
