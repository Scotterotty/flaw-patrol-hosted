import { describe, expect, it } from "vitest";
import { filledLine, fillStatus, linkedIndexes, missingKeys, parseSisterFill, planFill, sisterSteps, stepKey, suggestSisters, type SuggestCase } from "./sisters";

const CLIENTS = ["Web", "Unreal", "Unity iOS", "Web (remote user)"];

// A few of the R22 RC cases, as qTest exported them.
const signIn = (id: string, p: string): SuggestCase => ({
  id,
  title: `[${p}] - Account - Sign In / Out`,
  steps: sisterSteps([
    { action: "SIGN IN / OUT STEPS", expected: "", heading: true },
    { action: "Signing InA user is able to successfully sign in to their account.", expected: "User logs in" },
    { action: "Signing OutA user is able to successfully sign out of their account.", expected: "User is logged out" },
    { action: "CredentialsA user cannot sign in with an incorrect password.", expected: "User can't log in" },
  ]),
});
const LIB: SuggestCase[] = [
  signIn("w1", "WEB"),
  signIn("u1", "UNREAL"),
  signIn("i1", "UNITY"),
  { id: "w2", title: "[WEB] - In Space - Component - Text", steps: sisterSteps([{ action: "Can you change the Text field?", expected: "Yes" }, { action: "Billboard Mode can be set", expected: "Yes" }]) },
  { id: "w3", title: "[WEB] - Hub - Space List", steps: [] },
  { id: "w4", title: "[WEB] - In Space - UI - People Panel", steps: [] },
  { id: "u4", title: "[UNREAL] - In Space - UI - People Panel", steps: [] },
  { id: "w5", title: "[WEB] - In Space - Nodey - Cinematic Camera Flow", steps: [] },
];

describe("sister cases", () => {
  it("knows a step by its words, not its number", () => {
    expect(stepKey("  Signing In: a user can sign in! ")).toBe("signing in a user can sign in");
    expect(stepKey("", "Works as described")).toBe("works as described");
  });

  it("lists a case's steps without headings or repeats", () => {
    const s = sisterSteps([
      { action: "PEOPLE PANEL", expected: "", heading: true },
      { action: "Open the People menu", expected: "" },
      { action: "Open the People menu", expected: "" },
    ]);
    expect(s.map((x) => x.label)).toEqual(["Open the People menu"]);
  });

  it("finds a link's steps in a run's copy, every step when it names none", () => {
    const steps = [{ action: "HEADING" }, { action: "Signing In" }, { action: "Signing Out" }, { action: "Signing In" }];
    const headings = new Set([0]);
    expect(linkedIndexes(steps, [stepKey("Signing In")], headings)).toEqual([1, 3]);
    expect(linkedIndexes(steps, [], headings)).toEqual([1, 2, 3]);
    expect(missingKeys(sisterSteps([{ action: "Signing In", expected: "" }]), [stepKey("Signing In"), stepKey("Gone")])).toEqual(["gone"]);
  });

  it("fills only steps nobody marked, and notes the ones that disagree", () => {
    const plan = planFill(["UNTESTED", "PASSED", "FAILED", "IN_PROGRESS"], [0, 1, 2, 3], "PASSED");
    expect(plan.filled).toEqual([0, 3]);
    expect(plan.disagree).toEqual([2]);
    expect(plan.next).toEqual(["PASSED", "PASSED", "FAILED", "PASSED"]);
  });

  it("carries only a clear result", () => {
    expect(fillStatus("PASSED")).toBe("PASSED");
    expect(fillStatus("FAILED")).toBe("FAILED");
    expect(fillStatus("SKIPPED")).toBeNull();
    expect(fillStatus("IN_PROGRESS")).toBeNull();
  });

  it("suggests the sign in case on each platform for dry run Log in, with its sign in steps", () => {
    const s = suggestSisters({ title: "Log in", text: "User is able to login to all clients on the appropriate environment: Web, Unreal, Unity iOS" }, ["Web", "Unreal", "Unity iOS", "Web (remote user)"], CLIENTS, LIB);
    expect(s.map((x) => [x.client, x.caseId])).toEqual([
      ["Web", "w1"],
      ["Unreal", "u1"],
      ["Unity iOS", "i1"],
    ]);
    // Signing In and Credentials (cannot sign in), not Signing Out.
    expect(s[0].steps).toHaveLength(2);
    expect(s[0].steps.some((k) => k.startsWith("signing out"))).toBe(false);
  });

  it("matches different words for the same thing", () => {
    expect(suggestSisters({ title: "User List", text: "All users in space are visible on the user list panel" }, ["Web", "Unreal"], CLIENTS, LIB).map((x) => x.caseId)).toEqual(["w4", "u4"]);
    expect(suggestSisters({ title: "Camera Tools", text: "Web - user is able to add a cinematic camera" }, ["Web"], CLIENTS, LIB).map((x) => x.caseId)).toEqual(["w5"]);
    expect(suggestSisters({ title: "Soak test", text: "all clients must still work after 30 mins" }, ["Web"], CLIENTS, LIB)).toEqual([]);
  });

  it("reads a saved fill and says what filled", () => {
    expect(parseSisterFill(null)).toBeNull();
    expect(parseSisterFill({ steps: {}, disagree: [] })).toBeNull();
    expect(parseSisterFill({ steps: { 1: { status: "PASSED" } }, disagree: [] })?.steps[1].status).toBe("PASSED");
    expect(filledLine([{ title: "Sign In / Out", where: "Web RC 23" }, { title: "Sign In / Out", where: "Unreal RC 23" }])).toBe("Sign In / Out in Web RC 23 and Sign In / Out in Unreal RC 23");
  });
});
