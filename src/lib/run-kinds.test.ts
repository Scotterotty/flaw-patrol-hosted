import { describe, expect, it } from "vitest";
import { countsForRelease, kindIdFor, kindLabel, parseRunKinds } from "./run-kinds";

describe("run kinds", () => {
  it("has the built-ins first, keeps renames and custom kinds, and never renames Bug bash", () => {
    const kinds = parseRunKinds([
      { id: "smoke", name: "Quick check" },
      { id: "bash", name: "Party", hidden: true },
      { id: "regression", name: "Regression", suiteId: "s1" },
    ]);
    expect(kinds.map((k) => k.name)).toEqual(["Quick check", "Release candidate", "Bug bash", "Regression"]);
    expect(kinds.find((k) => k.id === "bash")!.hidden).toBe(false);
    expect(kinds.at(-1)!.suiteId).toBe("s1");
  });
  it("labels plain runs and unknown kinds as Run", () => {
    expect(kindLabel(parseRunKinds([]), "")).toBe("Run");
    expect(kindLabel(parseRunKinds([]), "gone")).toBe("Run");
    expect(kindLabel(parseRunKinds([]), "rc")).toBe("Release candidate");
  });
  it("makes free ids", () => {
    expect(kindIdFor("Regression!", ["regression"])).toBe("regression-2");
    expect(kindIdFor("RC", [])).toBe("rc-2");
  });
  it("counts release candidates and plain runs for release status", () => {
    expect([countsForRelease("rc"), countsForRelease(""), countsForRelease("smoke"), countsForRelease("bash")]).toEqual([true, true, true, false]);
  });
});
