import { describe, expect, it } from "vitest";
import { cameFromUs, closestCases, matchByTitle, parseQaseCaseId, parseStatusMap, qaseStatusFor, qaseTime, sentComment, qaseStepResults, titleKey } from "./qase-map";

describe("Qase status matching", () => {
  it("fills in defaults and drops anything that isn't a Qase status", () => {
    const m = parseStatusMap({ RETEST: "failed", SKIPPED: "", PASSED: "great", FAILED: 3 });
    expect(m).toEqual({ PASSED: "passed", FAILED: "failed", BLOCKED: "blocked", RETEST: "failed", SKIPPED: "" });
  });
  it("doesn't send untested, in progress, explored or turned-off statuses", () => {
    const m = parseStatusMap({ SKIPPED: "" });
    expect(qaseStatusFor("PASSED", m)).toBe("passed");
    expect(qaseStatusFor("RETEST", m)).toBe("blocked");
    expect(qaseStatusFor("SKIPPED", m)).toBeNull();
    expect(qaseStatusFor("UNTESTED", m)).toBeNull();
    expect(qaseStatusFor("IN_PROGRESS", m)).toBeNull();
    expect(qaseStatusFor("EXPLORED", m)).toBeNull();
  });
});

describe("linking by title", () => {
  it("ignores case, punctuation and [tags]", () => {
    expect(titleKey("[web] Sign in — with Google!")).toBe("sign in with google");
  });
  it("links titles that appear once on each side, and skips taken Qase cases", () => {
    const ours = [
      { id: "a", title: "Sign in" },
      { id: "b", title: "Pay with a saved card" },
      { id: "c", title: "Open the map" },
      { id: "d", title: "Open the map" },
      { id: "e", title: "Log out" },
    ];
    const theirs = [
      { id: 1, title: "sign in" },
      { id: 2, title: "Pay with a saved card." },
      { id: 3, title: "Open the map" },
      { id: 4, title: "Log out" },
      { id: 5, title: "Log out" },
    ];
    expect([...matchByTitle(ours, theirs)]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(matchByTitle([{ id: "a", title: "Sign in" }], theirs, new Set([1])).size).toBe(0);
  });
  it("offers the closest Qase cases first", () => {
    const theirs = [
      { id: 1, title: "Show the offline message" },
      { id: 2, title: "Sign in with Google" },
      { id: 3, title: "Sign in with Microsoft" },
    ];
    expect(closestCases("Login with Google SSO", theirs).map((q) => q.id)).toEqual([2, 3]);
    expect(closestCases("", theirs)).toEqual([]);
  });
});

describe("Qase IDs and times", () => {
  it("reads OKO-42, 42 and Qase links", () => {
    expect(parseQaseCaseId("OKO-42", "OKO")).toBe(42);
    expect(parseQaseCaseId(" oko-42 ", "OKO")).toBe(42);
    expect(parseQaseCaseId("42", "OKO")).toBe(42);
    expect(parseQaseCaseId("https://app.qase.io/case/OKO-17", "OKO")).toBe(17);
    expect(parseQaseCaseId("https://app.qase.io/project/OKO?case=9&previewMode=side", "OKO")).toBe(9);
    expect(parseQaseCaseId("WEB-42", "OKO")).toBeNull();
    expect(parseQaseCaseId("0", "OKO")).toBeNull();
    expect(parseQaseCaseId("abc", "OKO")).toBeNull();
  });
  it("reads Qase's UTC times", () => {
    expect(qaseTime("2026-11-03 18:05:00")?.toISOString()).toBe("2026-11-03T18:05:00.000Z");
    expect(qaseTime("2026-11-03T18:05:00+00:00")?.toISOString()).toBe("2026-11-03T18:05:00.000Z");
    expect(qaseTime(null)).toBeNull();
    expect(qaseTime("soon")).toBeNull();
  });
  it("marks sent results so they never come back", () => {
    const c = sentComment("Sam", "  Looks fine  ");
    expect(c).toBe("From Flaw Patrol · Sam\n\nLooks fine");
    expect(cameFromUs(c)).toBe(true);
    expect(cameFromUs(sentComment("", ""))).toBe(true);
    expect(cameFromUs("Tested by hand")).toBe(false);
  });
});

describe("Qase step results", () => {
  const steps = [
    { action: "SPACE LISTS", expected: "" },
    { action: "Owned By You", expected: "Owned spaces show" },
    { action: "", expected: "" },
    { action: "Search Functionality", expected: "Letters work\nNumbers work" },
  ];
  it("puts each Qase step on the matching step, skipping empty ones", () => {
    const r = qaseStepResults(steps, "PASSED", [
      { status: 1, comment: "" },
      { status: 1, comment: "" },
      { status: 2, comment: "Numbers return nothing" },
    ]);
    expect(r.stepResults.map((s) => s.status)).toEqual(["PASSED", "PASSED", "UNTESTED", "FAILED"]);
    expect(r.stepResults[3].actual).toBe("Numbers return nothing");
    // Qase said Passed, but a step failed.
    expect(r.status).toBe("FAILED");
  });
  it("a blocked step blocks a passed case; a failed case stays failed", () => {
    expect(qaseStepResults(steps, "PASSED", [{ status: 1, comment: "" }, { status: 3, comment: "" }, { status: 1, comment: "" }]).status).toBe("BLOCKED");
    expect(qaseStepResults(steps, "FAILED", [{ status: 1, comment: "" }, { status: 3, comment: "" }, { status: 1, comment: "" }]).status).toBe("FAILED");
  });
  it("in-progress steps stay untested; status names work too", () => {
    const r = qaseStepResults(steps, "FAILED", [{ status: 7, comment: "" }, { status: "skipped", comment: "" }, { status: "2", comment: "" }]);
    expect(r.stepResults.map((s) => s.status)).toEqual(["UNTESTED", "SKIPPED", "UNTESTED", "FAILED"]);
  });
  it("no Qase steps, or a different count: every step takes the case's result as before", () => {
    expect(qaseStepResults(steps, "PASSED", []).stepResults.map((s) => s.status)).toEqual(["PASSED", "PASSED", "PASSED", "PASSED"]);
    const r = qaseStepResults(steps, "FAILED", [{ status: 2, comment: "" }]);
    expect(r.status).toBe("FAILED");
    expect(r.stepResults.every((s) => s.status === "UNTESTED")).toBe(true);
  });
});
