import { describe, expect, it } from "vitest";
import { andList, orList, bashGuestPath, linkTarget, safeInside } from "./link-access";

describe("shared links for people outside the team (ver_115)", () => {
  it("says what a link opens", () => {
    expect(linkTarget("/p/web/reports?tab=x")).toEqual({ kind: "project", key: "WEB", what: "a report", bashId: null });
    expect(linkTarget("/p/WEB/runs/12")).toMatchObject({ what: "a test run" });
    expect(linkTarget("/p/WEB/runs/import")).toMatchObject({ what: "a page" });
    expect(linkTarget("/p/WEB/cases/4")).toMatchObject({ what: "a test case" });
    expect(linkTarget("/p/WEB/bashes/abc/report")).toMatchObject({ what: "a bug bash", bashId: "abc" });
    expect(linkTarget("/p/WEB")).toMatchObject({ what: "its home page" });
    expect(linkTarget("/p/WEB/cases")).toMatchObject({ what: "the Case library" });
    expect(linkTarget("/g/g1/reports")).toEqual({ kind: "umbrella", groupId: "g1", what: "a report" });
    expect(linkTarget("/account")).toBeNull();
  });
  it("knows the bash pages a guest may open", () => {
    expect(bashGuestPath("/p/web/bashes/b1/join")).toEqual({ key: "WEB", id: "b1", page: "join" });
    expect(bashGuestPath("/p/WEB/bashes/b1?x=1")).toEqual({ key: "WEB", id: "b1", page: "" });
    expect(bashGuestPath("/p/WEB/bashes/b1/export")).toBeNull();
    expect(bashGuestPath("/p/WEB/bashes")).toBeNull();
    expect(bashGuestPath("/p/WEB/runs/1")).toBeNull();
  });
  it("joins names in plain words", () => {
    expect(andList([])).toBe("");
    expect(andList(["Dana"])).toBe("Dana");
    expect(andList(["Demo Admin", "Dana Lead"])).toBe("Demo Admin and Dana Lead");
    expect(andList(["A", "B", "C"])).toBe("A, B and C");
  });
  it("offers a choice of names with or", () => {
    expect(orList([])).toBe("");
    expect(orList(["Scott"])).toBe("Scott");
    expect(orList(["Scott", "Priya"])).toBe("Scott or Priya");
    expect(orList(["A", "B", "C"])).toBe("A, B or C");
  });
  it("only sends people to paths inside the app", () => {
    expect(safeInside("/p/WEB")).toBe("/p/WEB");
    expect(safeInside("//evil.com")).toBeNull();
    expect(safeInside("/\\evil.com")).toBeNull();
    expect(safeInside("https://evil.com")).toBeNull();
    expect(safeInside(undefined)).toBeNull();
  });
});
