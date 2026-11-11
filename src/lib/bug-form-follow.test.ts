import { describe, expect, it } from "vitest";
import { buildLine, versionIn, withHistory, type TemplateBug } from "./bug-template";

const bug = (repros: string, reproRate: string) =>
  ({ history: { dateTime: "", client: "", csp: "", context: "", user: "", envTenant: "", repros }, reproRate, build: "" }) as unknown as TemplateBug;

const free = { reproRate: false, build: false };

describe("Repro rate follows Repros", () => {
  it("copies Repros even when the two started different (Write a bug: blank Repros, Repro rate 1/1)", () => {
    expect(withHistory(bug("", "1/1"), "repros", "3/5", free).reproRate).toBe("3/5");
  });
  it("keeps following as Repros is typed", () => {
    let b = bug("1/1", "1/1");
    for (const v of ["", "3", "3/", "3/5"]) b = withHistory(b, "repros", v, free);
    expect(b.reproRate).toBe("3/5");
    expect(b.history.repros).toBe("3/5");
  });
  it("leaves a Repro rate typed by hand alone", () => {
    expect(withHistory(bug("1/1", "2 of 10"), "repros", "3/5", { reproRate: true, build: false }).reproRate).toBe("2 of 10");
  });
  it("other boxes don't touch Repro rate", () => {
    expect(withHistory(bug("1/1", "1/1"), "csp", "45.12.0", free).reproRate).toBe("1/1");
  });
});

describe("Build # follows Client and CSP", () => {
  it("takes the version numbers (Scott's example)", () => {
    let b = bug("1/1", "1/1");
    b = withHistory(b, "client", "Web 4.21.0", free);
    b = withHistory(b, "csp", "7.1.0", free);
    expect(b.build).toBe("Version 4.21.0 - CSP 7.1.0");
  });
  it("reads a version from a run's two-line Client box", () => {
    expect(buildLine("Web\n4.21.0-rc23", "CSP 7.1")).toBe("Version 4.21.0 - CSP 7.1");
  });
  it("uses x for a missing number, and stays blank when both are", () => {
    expect(buildLine("Web 4.21.0", "")).toBe("Version 4.21.0 - CSP x");
    expect(buildLine("Web", "")).toBe("");
    expect(versionIn("build 512")).toBe("512");
  });
  it("leaves a Build # typed by hand alone", () => {
    const b = { ...bug("1/1", "1/1"), build: "Hotfix 9" };
    expect(withHistory(b, "client", "Web 4.21.0", { reproRate: false, build: true }).build).toBe("Hotfix 9");
  });
});
