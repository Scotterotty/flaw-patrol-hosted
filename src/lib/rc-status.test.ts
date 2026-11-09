import { describe, expect, it } from "vitest";
import { barBlocks, bugKeys, buildLine, CF_BAR_WIDTH, confluenceHtml, DONE, plainText, shortTitle, stateOf, type RcColumn } from "./rc-status";

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

describe("Copy for Confluence look (ver_198)", () => {
  it("paints passed blocks green, which Confluence keeps on paste", () => {
    const html = confluenceHtml("RC 23", [col({ label: "Web", total: 2, done: 2, counts: { PASSED: 2 } })], []);
    expect(html).toContain('<span style="color:#36B37E">█');
    expect(html).not.toContain("#57D9A3");
  });
  it("drops the platform tag and cuts bug titles to one line", () => {
    expect(shortTitle("[UNREAL] - Annotations - Unreal crashes", "Unreal")).toBe("Annotations - Unreal crashes");
    expect(shortTitle("(WEB)(Scripts) Assets affected", "Web")).toBe("(Scripts) Assets affected");
    expect(shortTitle("[Unity] Space usage shows /-1KB; does not allow assets to be uploaded", "Unity")).toBe("Space usage shows /-1KB; does not allow…");
    expect(shortTitle("Hotspot components rotate", "Unreal")).toBe("Hotspot components rotate");
  });
  it("fills the bar to scale and always shows a failure", () => {
    const sum = (b: { blocks: number }[]) => b.reduce((n, p) => n + p.blocks, 0);
    const unity = barBlocks({ total: 38, counts: { PASSED: 18, FAILED: 1 } });
    expect(sum(unity)).toBe(CF_BAR_WIDTH);
    expect(unity.find((p) => p.status === "FAILED")?.blocks).toBe(1);
    expect(barBlocks({ total: 0, counts: {} })).toEqual([{ status: null, blocks: CF_BAR_WIDTH }]);
    expect(sum(barBlocks({ total: 61, counts: { PASSED: 57, FAILED: 3, BLOCKED: 1 } }))).toBe(CF_BAR_WIDTH);
  });
  it("pastes a status badge, centered title and one row per part", () => {
    const html = confluenceHtml("RC 23", [col({ label: "Web", total: 2, done: 2, counts: { PASSED: 2 } }), col({ label: "Unity", total: 4, done: 1, counts: { PASSED: 1 } })], []);
    expect(html).toContain('<h2 style="text-align:center">RC 23 TESTING STATUS</h2>');
    expect(html).toContain('data-node-type="status" data-color="green"');
    expect(html).toContain('data-node-type="status" data-color="blue"');
    expect(html).toContain("<tr><th>Web</th><th>Unity</th></tr>");
    expect(html).toContain("<h1>100%</h1>");
    expect(html).toContain("No bugs filed");
  });
});
