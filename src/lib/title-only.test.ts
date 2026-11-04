import { describe, expect, it } from "vitest";
import { stepCountFits, stepsToRun } from "./steps";
import { bugTitle } from "./jira-format";

describe("title-only cases run as one step", () => {
  it("turns a case with no steps into step 1 with its title", () => {
    expect(stepsToRun([], "ENSURE SCREEN RECORDING")).toEqual([{ number: "1", action: "ENSURE SCREEN RECORDING", expected: "", titleOnly: true }]);
  });
  it("puts the title in a lone step with an empty Step box, keeping its Expected", () => {
    expect(stepsToRun([{ number: "1", action: "  ", expected: "Model loads" }], "Site Model")).toEqual([{ number: "1", action: "Site Model", expected: "Model loads" }]);
  });
  it("leaves real steps alone", () => {
    const steps = [
      { number: "1", action: "", expected: "a" },
      { number: "2", action: "Open", expected: "b" },
    ];
    expect(stepsToRun(steps, "T")).toBe(steps);
    const one = [{ number: "1", action: "Open", expected: "" }];
    expect(stepsToRun(one, "T")).toBe(one);
  });
  it("accepts one step result, or none, for a case with no steps", () => {
    expect(stepCountFits(0, 0)).toBe(true);
    expect(stepCountFits(0, 1)).toBe(true);
    expect(stepCountFits(0, 2)).toBe(false);
    expect(stepCountFits(3, 3)).toBe(true);
    expect(stepCountFits(3, 1)).toBe(false);
  });
  it("doesn't repeat the title in a bug title", () => {
    expect(bugTitle("Screen record", { action: "Screen record", expected: "" }, "Recording stopped")).toBe("Screen record: Recording stopped");
    expect(bugTitle("Login", { action: "Type the password", expected: "" }, "Crashed")).toBe("Login: Type the password: Crashed");
  });
});
