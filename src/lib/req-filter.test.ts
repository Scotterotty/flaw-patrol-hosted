import { describe, expect, it } from "vitest";
import { pickedProject, pickedReleases, projectOfKey, releaseLabel, reqQuery } from "./req-filter";

describe("Requirements filters (ver_161)", () => {
  const releases = ["2.4", "Web 2.4", "2.3"];
  it("keeps only releases Jira lists, in the order picked", () => {
    expect(pickedReleases(["Web 2.4", "2.4", "nope", "2.4"], releases)).toEqual(["Web 2.4", "2.4"]);
    expect(pickedReleases("2.3", releases)).toEqual(["2.3"]);
    expect(pickedReleases(undefined, releases)).toBeNull();
    expect(pickedReleases("nope", releases)).toBeNull();
    expect(pickedReleases(["any", "2.4"], releases)).toBe("any");
  });
  it("only takes a project filter with two or more projects", () => {
    expect(pickedProject("mob", ["OW", "MOB"])).toBe("MOB");
    expect(pickedProject("MOB", ["MOB"])).toBeNull();
    expect(pickedProject("XX", ["OW", "MOB"])).toBeNull();
    expect(pickedProject("MOB", null)).toBeNull();
  });
  it("builds links that keep the picks", () => {
    expect(reqQuery({ releases: ["2.4", "Web 2.4"], proj: "MOB" })).toBe("?release=2.4&release=Web+2.4&proj=MOB");
    expect(reqQuery({ releases: "any" }, { show: "none" })).toBe("?release=any&show=none");
    expect(reqQuery({})).toBe("");
    expect(projectOfKey("mob-88")).toBe("MOB");
    expect(releaseLabel(["2.4", "Web 2.4"])).toBe("2.4 + Web 2.4");
  });
});
