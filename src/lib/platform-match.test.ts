import { describe, expect, it } from "vitest";
import { isOnPlatform, platformCaseOr, platformTags } from "./platform-match";

describe("platform chip match (ver_158)", () => {
  const web = { name: "Web", suiteIds: [] as string[] };
  it("finds the platform's tag in any case", () => {
    expect(platformTags(web, ["WEB", "Account", "web", "Website"])).toEqual(["WEB", "web"]);
  });
  it("matches tagged cases when the platform has no suites", () => {
    expect(platformCaseOr(web, ["Web", "Account"])).toEqual([{ tags: { hasSome: ["Web"] } }]);
  });
  it("adds suites and picked cases", () => {
    const or = platformCaseOr({ name: "Web", suiteIds: ["s1"], caseIds: ["c1"] }, []);
    expect(or).toEqual([{ suites: { some: { suiteId: { in: ["s1"] } } } }, { id: { in: ["c1"] } }]);
  });
  it("matches nothing when nothing is set up", () => {
    expect(platformCaseOr({ name: "Unity", suiteIds: [] }, ["Web"])).toEqual([{ id: { in: [] } }]);
  });
  it("row dots use the same rule", () => {
    expect(isOnPlatform(web, { id: "a", tags: ["WEB", "Account"], suiteIds: new Set() })).toBe(true);
    expect(isOnPlatform({ name: "Web", suiteIds: [], caseIds: ["b"] }, { id: "b", tags: [], suiteIds: new Set() })).toBe(true);
    expect(isOnPlatform({ name: "Web", suiteIds: ["s"] }, { id: "c", tags: ["Unity"], suiteIds: new Set(["x"]) })).toBe(false);
  });
});
