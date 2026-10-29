import { describe, expect, it } from "vitest";
import { diffLists } from "./diff";

describe("diffLists", () => {
  it("marks inserted, removed and kept items in order", () => {
    expect(diffLists(["a", "b", "c"], ["a", "x", "c", "d"]).map((d) => `${d.op[0]}${d.value}`)).toEqual(["sa", "rb", "ax", "sc", "ad"]);
  });
  it("handles empty lists", () => {
    expect(diffLists([], ["a"])).toEqual([{ op: "added", value: "a" }]);
    expect(diffLists(["a"], [])).toEqual([{ op: "removed", value: "a" }]);
  });
});
