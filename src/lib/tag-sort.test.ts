import { describe, expect, it } from "vitest";
import { sortTagCounts, sortTags } from "./tags";

describe("tag order", () => {
  it("sorts A to Z without capitals first", () => {
    expect(sortTags(["Web", "UNIQUE CASES", "AI", "Account", "AR", "unity", "UI", "Unreal"])).toEqual(["Account", "AI", "AR", "UI", "UNIQUE CASES", "unity", "Unreal", "Web"]);
  });
  it("counts first when asked, ties A to Z", () => {
    const rows = [
      { tag: "Spaces", count: 4 },
      { tag: "In Space", count: 81 },
      { tag: "Plugin Setup", count: 4 },
      { tag: "AI", count: 3 },
    ];
    expect(sortTagCounts(rows, "count").map((r) => r.tag)).toEqual(["In Space", "Plugin Setup", "Spaces", "AI"]);
    expect(sortTagCounts(rows, "az").map((r) => r.tag)).toEqual(["AI", "In Space", "Plugin Setup", "Spaces"]);
  });
});
