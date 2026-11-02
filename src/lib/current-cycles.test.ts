import { describe, expect, it } from "vitest";
import { splitCycles } from "./current-cycles";

const c = (name: string, platform: string, keepCurrent = false, archived = false) => ({ name, platform, keepCurrent, archived });
const live = (x: { archived: boolean }) => !x.archived;
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe("splitCycles", () => {
  it("keeps the newest cycle per platform current", () => {
    const { current, older } = splitCycles([c("Web RC 2", "Web"), c("Web RC 1", "Web"), c("Unity RC 1", "Unity")], live, ["Web", "Unity"]);
    expect(names(current)).toEqual(["Web RC 2", "Unity RC 1"]);
    expect(names(older)).toEqual(["Web RC 1"]);
  });

  it("keeps a pinned cycle current without taking its platform's spot", () => {
    const { current, older } = splitCycles([c("Web RC 1", "Web"), c("Web", "Web"), c("Build health", "Web", true)], live, ["Web"]);
    expect(names(current)).toEqual(["Web RC 1", "Build health"]);
    expect(names(older)).toEqual(["Web"]);
  });

  it("lets a pinned cycle newer than the RC leave the RC current", () => {
    const { current } = splitCycles([c("Build health", "Web", true), c("Web RC 1", "Web")], live, ["Web"]);
    expect(names(current)).toEqual(["Web RC 1", "Build health"]);
  });

  it("puts archived cycles in Older even when pinned", () => {
    const { current, older } = splitCycles([c("Build health", "Web", true, true), c("Web RC 1", "Web")], live, ["Web"]);
    expect(names(current)).toEqual(["Web RC 1"]);
    expect(names(older)).toEqual(["Build health"]);
  });

  it("keeps cycles without a platform current", () => {
    const { current } = splitCycles([c("Smoke", ""), c("Other", "")], live, []);
    expect(names(current)).toEqual(["Other", "Smoke"]);
  });
});
