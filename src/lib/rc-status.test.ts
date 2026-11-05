import { describe, expect, it } from "vitest";
import { bugKeys, buildLine, confluenceHtml, DONE, plainText, stateOf, type RcColumn } from "./rc-status";

const col = (o: Partial<RcColumn> = {}): RcColumn => ({
  id: "r", href: "", label: "Unity", runName: "", runIds: ["r"], runs: [], build: "", extra: "", completed: false, total: 39, done: 0, counts: {}, testedAt: [], severities: {}, bugList: [], ...o,
});

describe("RC status label", () => {
  it("is DONE only when every case was run", () => {
    expect(stateOf(col({ done: 39 })).label).toBe("DONE");
    expect(stateOf(col({ done: 39, completed: true })).label).toBe("DONE");
  });
  it("says what was left when a run was closed early", () => {
    expect(stateOf(col({ done: 38, completed: true })).label).toBe("CLOSED · 1 NOT RUN");
  });
  it("is in progress or not started while the run is open", () => {
    expect(stateOf(col({ done: 38 })).label).toBe("IN PROGRESS");
    expect(stateOf(col({ counts: { RETEST: 2 } })).label).toBe("IN PROGRESS");
    expect(stateOf(col({})).label).toBe("NOT STARTED");
  });
  it("counts skipped as run, like the run page", () => {
    expect(DONE).toContain("SKIPPED");
    expect(DONE).not.toContain("RETEST");
  });
});

describe("Release status card (ver_182)", () => {
  it("puts the release before the build, never a run number", () => {
    expect(buildLine("RC 23", { build: "4.20.1", extra: "CSP 7.1.0" })).toBe("RC 23 · 4.20.1 · CSP 7.1.0");
    expect(buildLine("RC 23", { build: "", extra: "" })).toBe("RC 23");
  });
  it("lists the bugs instead of passed/failed counts and severities", () => {
    const c = col({ label: "Web", total: 2, done: 2, counts: { PASSED: 1, FAILED: 1 }, severities: { CRITICAL: 1 }, bugList: [{ key: "OB-6048", url: "https://jira.example.com/browse/OB-6048", title: "URL Video crash" }] });
    expect(bugKeys(c)).toBe("OB-6048");
    expect(bugKeys(col())).toBe("No bugs");
    const text = plainText("RC 23", [c], []);
    expect(text).toContain("Web (RC 23): DONE, 100%");
    expect(text).toContain("  OB-6048 URL Video crash");
    expect(text).not.toContain("1 passed");
    const html = confluenceHtml("RC 23", [c], []);
    expect(html).toContain('<a href="https://jira.example.com/browse/OB-6048">OB-6048</a> URL Video crash');
    expect(html).not.toContain("1 failed");
  });
});
