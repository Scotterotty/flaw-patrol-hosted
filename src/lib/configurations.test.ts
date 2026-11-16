import { describe, expect, it } from "vitest";
import { blankHint, blankNames, configId, fillPlanBlanks, pairingCount, pairings, parseConfigurations, passedPct, planCountLine, planCounts, planRunName, splitEvenly, valuesFromText } from "./configurations";
import { defaultSummary } from "./jira-format";

describe("Configurations", () => {
  it("reads values pasted from a sheet, one per line, without blanks or repeats", () => {
    expect(valuesFromText("Windows\r\nMac\n\n  Quest 3 \nmac\niPhone\tAndroid")).toEqual(["Windows", "Mac", "Quest 3", "iPhone", "Android"]);
  });

  it("keeps only readable saved Configurations", () => {
    expect(parseConfigurations([{ id: "p", name: "Platforms", values: ["Mac"] }, { id: "x", name: " ", values: [] }, "junk", null])).toEqual([{ id: "p", name: "Platforms", values: ["Mac"] }]);
    expect(parseConfigurations(null)).toEqual([]);
  });

  it("makes every pairing in order, skipping Configurations with nothing ticked", () => {
    const picks = [
      { name: "Songs", values: ["Neverender", "Levitating"] },
      { name: "Languages", values: [] },
      { name: "Platforms", values: ["Mac", "Quest 3"] },
    ];
    expect(pairings(picks).map((p) => p.map((v) => v.value).join(" · "))).toEqual(["Neverender · Mac", "Neverender · Quest 3", "Levitating · Mac", "Levitating · Quest 3"]);
    expect(pairingCount(picks)).toBe(4);
    expect(pairings([])).toEqual([]);
    expect(pairingCount([{ name: "Songs", values: [] }])).toBe(0);
  });

  it("names a plan's runs after the plan and the value", () => {
    expect(planRunName("Creatures pass", [{ name: "Songs", value: "Neverender" }, { name: "Platforms", value: "Quest 3" }])).toBe("Creatures pass · Neverender · Quest 3");
  });

  it("says how many runs the ticks make before anything is made", () => {
    expect(planCountLine(9, 3)).toBe("This makes 1 test plan with 9 runs (3 cases each, 27 to test).");
    expect(planCountLine(1, 1)).toBe("This makes 1 test plan with 1 run (1 case each, 1 to test).");
    expect(planCountLine(2, 0, 3)).toBe("This makes a test plan in each of 3 test cycles with 2 runs.");
  });

  it("fills {{blanks}} named after the Configuration, singular or plural, any case", () => {
    expect(blankNames("Songs")).toEqual(expect.arrayContaining(["songs", "song"]));
    expect(blankNames("Build types")).toEqual(expect.arrayContaining(["build_types", "buildtypes", "build_type"]));
    expect(blankNames("Countries")).toContain("country");
    expect(blankNames("Boxes")).toContain("box");
    expect(blankHint("Platforms")).toBe("{{platform}}");
    const values = [{ name: "Songs", value: "Neverender" }];
    expect(fillPlanBlanks("Play {{song}} then {{ Songs }}; keep {{user}}", values)).toEqual({ text: "Play Neverender then Neverender; keep {{user}}", used: ["Neverender"] });
    expect(fillPlanBlanks("No blanks here", values)).toEqual({ text: "No blanks here", used: [] });
  });

  it("counts passed, failed and not run, and % passed out of every case", () => {
    const c = planCounts(["PASSED", "PASSED", "FAILED", "UNTESTED", "RETEST", "BLOCKED"]);
    expect(c).toEqual({ passed: 2, failed: 1, notRun: 2, total: 6, tested: 4 });
    expect(passedPct(c)).toBe("33%");
    expect(passedPct(planCounts([]))).toBe("–");
  });

  it("shares runs out in turn", () => {
    expect([...splitEvenly(["a", "b", "c", "d"], ["sam", "kim"])]).toEqual([
      ["a", "sam"],
      ["b", "kim"],
      ["c", "sam"],
      ["d", "kim"],
    ]);
    expect(splitEvenly(["a"], []).size).toBe(0);
  });

  it("makes ids unlike the ones already there", () => {
    expect(configId("Platforms", [])).toBe("platforms");
    expect(configId("Platforms", ["platforms"])).toBe("platforms-2");
    expect(configId("!!!", [])).toBe("config");
  });

  it("puts a plan run's value in front of the bug summary", () => {
    const ctx = { caseTitle: "Creature spawns on the beat", steps: [], failedIndex: null, actual: "Half a beat late", titleTags: [], planTag: "Neverender" };
    expect(defaultSummary(ctx)).toBe("[Neverender] Creature spawns on the beat: Half a beat late");
    expect(defaultSummary({ ...ctx, planTag: undefined })).toBe("Creature spawns on the beat: Half a beat late");
  });
});
