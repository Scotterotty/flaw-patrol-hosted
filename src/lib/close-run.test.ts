import { describe, expect, it } from "vitest";
import { closeRunNote, untestedLine, whoseLists } from "./close-run";

describe("Close run check", () => {
  it("names whose lists change", () => {
    expect(whoseLists(["Mia Member"])).toBe("Mia Member's list");
    expect(whoseLists(["Mia Member", "Lee Lead", "Mia Member"])).toBe("Mia Member's and Lee Lead's lists");
    expect(whoseLists(["A", "B", "C"])).toBe("3 people's lists");
    expect(whoseLists([])).toBe("");
  });
  it("reads as the mockup", () => {
    expect(untestedLine(5, 8)).toBe("5 of 8 cases haven't been tested.");
    expect(closeRunNote(["Mia Member"])).toBe("They come off Mia Member's list and stay Untested in reports. You can reopen the run later.");
    expect(closeRunNote([])).toBe("They stay Untested in reports. You can reopen the run later.");
  });
});
