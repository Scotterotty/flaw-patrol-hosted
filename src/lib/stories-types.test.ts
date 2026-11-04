import { describe, expect, it } from "vitest";
import { parseStoriesConfig, requirementTypes } from "./stories-config";

describe("Every issue type (Requirements)", () => {
  it("is off for settings saved before it existed, and keeps the ticked types", () => {
    const c = parseStoriesConfig({ project: "OW", types: ["Story", "Task"] });
    expect(c?.allTypes).toBe(false);
    expect(requirementTypes(c!)).toBe("Story, Task");
  });
  it("reads as every type except Sub-tasks when on, and still remembers the ticks", () => {
    const c = parseStoriesConfig({ project: "OW", types: ["Story"], allTypes: true });
    expect(c?.allTypes).toBe(true);
    expect(c?.types).toEqual(["Story"]);
    expect(requirementTypes(c!)).toBe("every issue type except Sub-tasks");
  });
  it("ignores anything but true", () => {
    expect(parseStoriesConfig({ types: [], allTypes: "yes" })?.allTypes).toBe(false);
  });
});
