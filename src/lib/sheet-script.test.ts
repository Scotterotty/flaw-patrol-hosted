import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { sheetScript } from "./sheet-script";

// A small stand-in for Google Sheets: one tab of plain values, enough for the script's read and fill.
function fakeGoogle(values: string[][], lists: Record<number, string[]> = {}) {
  const props: Record<string, string> = {};
  const links: Record<string, { from: number; to: number; url: string }[]> = {};
  const VALUE_IN_LIST = "VALUE_IN_LIST";
  const width = () => Math.max(...values.map((r) => r.length));
  const get = (r: number, c: number) => values[r - 1]?.[c - 1] ?? "";
  const set = (r: number, c: number, v: string) => {
    while (values.length < r) values.push([]);
    values[r - 1][c - 1] = v;
  };
  const range = (r: number, c: number, nr = 1, nc = 1) => ({
    getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(r + i, c + j))),
    getDataValidations: () =>
      Array.from({ length: nr }, () =>
        Array.from({ length: nc }, (_, j) => (lists[c + j] ? { getCriteriaType: () => VALUE_IN_LIST, getCriteriaValues: () => [lists[c + j]] } : null)),
      ),
    setValue: (v: string) => set(r, c, v.charAt(0) === "'" ? v.slice(1) : v),
    setRichTextValue: (t: { text: string; links: { from: number; to: number; url: string }[] }) => {
      set(r, c, t.text);
      links[`${r}:${c}`] = t.links;
    },
  });
  const sheet = {
    getLastRow: () => values.length,
    getLastColumn: () => width(),
    getMaxRows: () => values.length,
    getMaxColumns: () => width(),
    getRange: range,
    getSheetId: () => 7,
  };
  const book = { getSheetByName: (n: string) => (n === "Checklist" ? sheet : null), getUrl: () => "https://docs.google.com/spreadsheets/d/x/edit" };
  const rich = () => {
    const t = { text: "", links: [] as { from: number; to: number; url: string }[] };
    const b = {
      setText: (s: string) => ((t.text = s), b),
      setLinkUrl: (from: number, to: number, url: string) => (t.links.push({ from, to, url }), b),
      build: () => t,
    };
    return b;
  };
  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book, DataValidationCriteria: { VALUE_IN_LIST }, newRichTextValue: rich },
    PropertiesService: { getDocumentProperties: () => ({ getProperties: () => ({ ...props }), setProperties: (o: Record<string, string>) => Object.assign(props, o) }) },
    LockService: { getDocumentLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s: string) => ({ setMimeType: () => JSON.parse(s) }) },
  };
  const ctx: Record<string, unknown> = { ...globals };
  runInNewContext(sheetScript("k3y"), ctx);
  const post = (body: object) => (ctx.doPost as (e: unknown) => Record<string, unknown>)({ postData: { contents: JSON.stringify({ secret: "k3y", ...body }) } });
  return { post, values, links };
}

describe("the sheet's script", () => {
  it("reads the tab's words and dropdowns", () => {
    const g = fakeGoogle(
      [
        ["Test", "Result"],
        ["Alpha", "Pass"],
      ],
      { 2: ["Pass", "Fail"] },
    );
    const r = g.post({ action: "read", tab: "Checklist" });
    expect(r).toMatchObject({ ok: true, version: 2, values: [["Test", "Result"], ["Alpha", "Pass"]], lists: [null, ["Pass", "Fail"]] });
    expect(g.post({ action: "read", tab: "Nope" })).toMatchObject({ ok: false, error: 'This sheet has no tab called "Nope".' });
    expect(g.post({ action: "read", tab: "Checklist", secret: "wrong" })).toMatchObject({ ok: false });
  });

  it("fills empty and Untested cells, keeps typed ones, and updates its own later", () => {
    const g = fakeGoogle([
      ["Test", "Result", "Bug"],
      ["Alpha", "", ""],
      ["Bravo", "Untested", ""],
      ["Charlie", "Skip, build late", ""],
    ]);
    const first = g.post({
      action: "fill",
      tab: "Checklist",
      cells: [
        { r: 2, c: 2, v: "Pass" },
        { r: 3, c: 2, v: "Fail" },
        { r: 3, c: 3, v: "CSP-1, CSP-2", links: [{ text: "CSP-2", url: "https://jira/CSP-2" }] },
        { r: 4, c: 2, v: "Pass" },
      ],
    });
    expect(first).toMatchObject({ ok: true, version: 2, filled: 3, kept: 1 });
    expect(g.values.map((r) => r[1])).toEqual(["Result", "Pass", "Fail", "Skip, build late"]);
    expect(g.links["3:3"]).toEqual([{ from: 7, to: 12, url: "https://jira/CSP-2" }]);

    // Someone types over Alpha's result: from then on it's theirs. Bravo is still Flaw Patrol's to change.
    g.values[1][1] = "Pass on retry";
    const second = g.post({
      action: "fill",
      tab: "Checklist",
      cells: [
        { r: 2, c: 2, v: "Fail" },
        { r: 3, c: 2, v: "Pass" },
      ],
    });
    expect(second).toMatchObject({ filled: 1, kept: 1 });
    expect(g.values[1][1]).toBe("Pass on retry");
    expect(g.values[2][1]).toBe("Pass");

    // A cell that would read as a formula goes in as text, and still counts as Flaw Patrol's next time.
    g.post({ action: "fill", tab: "Checklist", cells: [{ r: 2, c: 3, v: "'=1+1" }] });
    expect(g.values[1][2]).toBe("=1+1");
    expect(g.post({ action: "fill", tab: "Checklist", cells: [{ r: 2, c: 3, v: "" }] })).toMatchObject({ filled: 1, kept: 0 });
  });
});
