import { describe, expect, it } from "vitest";
import { listKeys, mergeReleases, parseStoriesConfig, requirementProjects, requirementSource } from "./stories-config";

// ver_161: requirements from several Jira projects.
describe("requirement projects", () => {
  it("reads old settings with one project, and new ones with several", () => {
    expect(parseStoriesConfig({ project: "OW", types: ["Story"] })?.projects).toEqual([]);
    expect(parseStoriesConfig({ project: "OW", projects: ["ow", "MOB", "MOB", " ", 3], types: ["Story"] })?.projects).toEqual(["OW", "MOB"]);
  });

  it("picks the bug project, one project, several, or any", () => {
    expect(requirementProjects({ project: "", projects: [] }, "OB")).toEqual(["OB"]);
    expect(requirementProjects({ project: "OW", projects: [] }, "OB")).toEqual(["OW"]);
    expect(requirementProjects({ project: "OW", projects: ["OW", "MOB", "WEB"] }, "OB")).toEqual(["OW", "MOB", "WEB"]);
    expect(requirementProjects({ project: "*", projects: [] }, "OB")).toBeNull();
  });

  it("says where requirements come from in words", () => {
    expect(listKeys(["OW", "MOB", "WEB"])).toBe("OW, MOB and WEB");
    expect(requirementSource({ project: "", projects: [] }, "OB")).toBe("Jira project OB");
    expect(requirementSource({ project: "OW", projects: ["OW", "MOB"] }, "OB")).toBe("Jira projects OW and MOB");
    expect(requirementSource({ project: "*", projects: [] }, "OB")).toBe("any Jira project");
  });

  it("merges release lists newest first, taking turns, each name once", () => {
    expect(mergeReleases([["2.4", "2.3"], ["2.4", "2.3"], ["Web 2.4", "Web 2.3"]])).toEqual(["2.4", "Web 2.4", "2.3", "Web 2.3"]);
    expect(mergeReleases([["RC 23", "RC 22"], []])).toEqual(["RC 23", "RC 22"]);
  });
});
