import { describe, expect, it } from "vitest";
import { bugsByPlatform, cleanPlatform, cleanPlatforms, onPlatform, platformLine, plusOnesOf, seenOn, startSchema } from "./bash";

// Bug bash platforms (ver_146): optional, and the report counts bugs, never people.

describe("bug bash platforms", () => {
  it("tidies typed platform names and drops repeats", () => {
    expect(cleanPlatform("  Pixel   8  ")).toBe("Pixel 8");
    expect(cleanPlatform(7)).toBe("");
    expect(cleanPlatforms(["Web", "web", " ", "Unity", 3, "x".repeat(60)])).toEqual(["Web", "Unity", "x".repeat(40)]);
  });

  it("keeps the platform on a +1 and reads old +1s without one", () => {
    expect(plusOnesOf([{ id: "u1", name: "Raj", platform: "Web" }, { id: "u2", name: "Lee" }])).toEqual([
      { id: "u1", name: "Raj", platform: "Web" },
      { id: "u2", name: "Lee", platform: "" },
    ]);
  });

  it("lists where a bug was seen, the logged platform first", () => {
    expect(seenOn({ platform: "Unity", plusOnes: [{ platform: "Web" }, { platform: "unity" }, { platform: "" }] })).toEqual(["Unity", "Web"]);
    expect(seenOn({ platform: "", plusOnes: [] })).toEqual([]);
  });

  it("counts bugs per platform, a bug on two platforms on both", () => {
    const rows = bugsByPlatform(
      [
        { platform: "Unity", severity: "CRITICAL", plusOnes: [{ platform: "Web" }] },
        { platform: "Web", severity: "MINOR", plusOnes: [] },
        { platform: "", severity: "PROBLEMATIC", plusOnes: [] },
        { platform: "Pixel 8", severity: "SHOWSTOPPER", plusOnes: [] },
      ],
      ["Web", "Unity", "Unreal"],
    );
    expect(rows).toEqual([
      { platform: "Web", bugs: 2, high: 1, onlyHere: 1, elsewhere: 1 },
      { platform: "Unity", bugs: 1, high: 1, onlyHere: 0, elsewhere: 1 },
      { platform: "Unreal", bugs: 0, high: 0, onlyHere: 0, elsewhere: 0 },
      { platform: "Pixel 8", bugs: 1, high: 1, onlyHere: 1, elsewhere: 0 },
      { platform: "", bugs: 1, high: 0, onlyHere: 1, elsewhere: 0 },
    ]);
    expect(platformLine(rows)).toBe("Web 2, Unity 1, Pixel 8 1");
  });

  it("says nothing extra when nobody gave a platform", () => {
    expect(platformLine(bugsByPlatform([{ platform: "", severity: "MINOR", plusOnes: [] }]))).toBe("");
    expect(onPlatform("")).toBe("");
    expect(onPlatform("Web")).toBe(" on Web");
  });

  it("starts a bash without platforms unless some are given", () => {
    const base = { name: "Bash", minutes: 30, areas: [{ name: "Cart" }] };
    expect(startSchema.parse(base).platforms).toEqual([]);
    expect(startSchema.parse({ ...base, platforms: ["Web"] }).platforms).toEqual(["Web"]);
  });
});
