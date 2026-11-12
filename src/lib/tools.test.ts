import { describe, expect, it } from "vitest";
import { everything, fixNeeds, presetOf, reportsHome, reportTabs, TOOL_IDS, toolOfPath, toolsLine, toolsOn, toolsValue, turnOff, turnOn } from "./tools";
import { guessRisk } from "./risk";

describe("umbrella tools (ver_128)", () => {
  it("starts with every tool for old umbrellas and unreadable values", () => {
    expect(toolsOn({})).toEqual([...TOOL_IDS]);
    expect(toolsOn(null)).toEqual([...TOOL_IDS]);
    expect(toolsOn({ off: ["nope", 3] })).toEqual([...TOOL_IDS]);
    expect(everything(toolsOn({}))).toBe(true);
  });

  it("saves what's off, so a new tool starts on", () => {
    expect(toolsValue(["bashes", "stories", "risk"])).toEqual({ off: ["cases", "runs", "charters", "auto", "quest", "glossary"] });
    expect(toolsOn(toolsValue(["bashes", "stories", "risk"]))).toEqual(["bashes", "stories", "risk"]);
  });

  it("never keeps a tool whose needs are off", () => {
    expect(fixNeeds(["runs", "quest"])).toEqual([]);
    expect(fixNeeds(["risk"])).toEqual([]);
    expect(toolsOn({ off: ["cases"] })).toEqual(["bashes", "stories", "risk", "glossary"]);
  });

  it("turns on what a tool needs, and off what needs it", () => {
    expect(turnOn(["bashes"], "risk")).toEqual({ on: ["bashes", "stories", "risk"], also: ["stories"] });
    expect(turnOn([], "quest").also).toEqual(["cases", "runs"]);
    const off = turnOff([...TOOL_IDS], "cases");
    expect(off.on).toEqual(["bashes", "stories", "risk", "glossary"]);
    expect(off.also).toEqual(["runs", "charters", "auto", "quest"]);
  });

  it("names presets and the Umbrellas page line", () => {
    expect(presetOf([...TOOL_IDS])).toBe("all");
    expect(presetOf(["risk", "bashes", "stories"])).toBe("bash");
    expect(presetOf(["bashes"])).toBe("own");
    expect(toolsLine([...TOOL_IDS])).toBe("");
    expect(toolsLine(["bashes", "stories", "risk"])).toBe("Bug bashes · Requirements · Risk board");
  });

  it("knows which tool a page belongs to", () => {
    const at = { g: "g1", hub: "PT", cycles: ["PTW1"] };
    expect(toolOfPath("/p/PT/cases/3", at)).toBe("cases");
    expect(toolOfPath("/p/PT/suites", at)).toBe("cases");
    expect(toolOfPath("/g/g1/runs", at)).toBe("runs");
    expect(toolOfPath("/g/g1/rc", at)).toBe("runs");
    expect(toolOfPath("/p/PTW1/runs/2", at)).toBe("runs");
    expect(toolOfPath("/p/PTW1/quests", at)).toBe("quest");
    expect(toolOfPath("/p/PT/bashes/x/report", at)).toBe("bashes");
    expect(toolOfPath("/p/PT/risk", at)).toBe("risk");
    expect(toolOfPath("/g/g1/status/github", at)).toBe("auto");
    // Status itself is for every umbrella (ver_228): TeamCity and Sentry need no tool.
    expect(toolOfPath("/g/g1/status", at)).toBe(null);
    expect(toolOfPath("/g/g1", at)).toBeNull();
    expect(toolOfPath("/g/g1/bugs", at)).toBeNull();
    expect(toolOfPath("/g/g1/settings", at)).toBeNull();
    expect(toolOfPath("/p/PTW1/bugs", at)).toBeNull();
    // A key that starts with another's isn't mistaken for it.
    expect(toolOfPath("/p/PTX/cases", at)).toBeNull();
  });

  it("shows Reports tabs for tools that are on", () => {
    const tabs = reportTabs({ g: "g1", hub: "PT", tools: ["bashes", "stories", "risk"] }, "stories").map((t) => t.label);
    expect(tabs).toEqual(["Requirements", "Bug bashes", "Custom reports"]);
    expect(reportsHome({ g: "g1", tools: ["bashes", "stories", "risk"] })).toBe("/g/g1/stories");
    expect(reportsHome({ g: "g1", tools: ["bashes"] })).toBe("/g/g1/reports/custom");
    expect(reportsHome({ g: "g1", tools: [...TOOL_IDS] })).toBe("/g/g1/reports");
  });

  it("leaves 'No tests yet' out of the risk guess without Test cases", () => {
    const s = { priority: "Medium", points: null, cases: 0, pastBugs: 0, failing: false };
    expect(guessRisk(s).reasons).toContain("No tests yet");
    const without = guessRisk({ ...s, withCases: false });
    expect(without.reasons).not.toContain("No tests yet");
    expect(without.likelihood).toBe(1);
  });
});
