import { describe, expect, it } from "vitest";
import { addRowToAdf, answersAdf, bugAdf, bugText, defaultSummary, didNot, parseIssueKey, type BugContext } from "./jira-format";

const ctx: BugContext = {
  caseKey: "SHOP-4",
  caseTitle: "Checkout with a saved card",
  runLabel: "run R7 Regression",
  build: "2.4.1",
  environment: "staging",
  preconditions: "",
  steps: [
    { number: "1.1", action: "Open /login", expected: "Form" },
    { number: "1.2", action: "Sign in", expected: "Home" },
    { number: "2", action: "Place order", expected: "Confirmation shown" },
    { number: "3", action: "Check email", expected: "Email arrives" },
  ],
  failedIndex: 2,
  actual: "500 error",
  link: "https://tm.example/p/SHOP/runs/7?entry=x",
};

describe("bug formatting", () => {
  it("summarizes the failing step", () => {
    expect(defaultSummary(ctx)).toBe("Checkout with a saved card: Place order: 500 error");
    expect(defaultSummary({ ...ctx, failedIndex: null, actual: "" })).toBe("Checkout with a saved card");
  });
  it("says what didn't happen when nothing was typed", () => {
    expect(defaultSummary({ ...ctx, actual: "" })).toBe("Checkout with a saved card: Place order: Not as expected: Confirmation shown");
    expect(didNot("Payment sheet opens")).toBe("Payment sheet does not open");
    expect(didNot("The order is saved.")).toBe("The order is not saved");
    expect(didNot("Cart count goes up")).toBe("Cart count does not go up");
    expect(didNot("Banner closes")).toBe("Banner does not close");
    expect(didNot("App fixes the typo")).toBe("App does not fix the typo");
    expect(didNot("Search tries again")).toBe("Search does not try again");
    expect(didNot("Menu watches focus")).toBe("Menu does not watch focus");
  });
  it("lists steps up to the failure with expected and actual", () => {
    const t = bugText(ctx);
    expect(t).toContain("1. Open /login\n2. Sign in\n3. Place order");
    expect(t).not.toContain("Check email");
    expect(t).toContain("Expected: Confirmation shown");
    expect(t).toContain("Actual: 500 error");
    expect(t).toContain("Build: 2.4.1 · Environment: staging");
    expect(bugText({ ...ctx, cspVersion: "3.8.1" })).toContain("Build: 2.4.1 · CSP version: 3.8.1 · Environment: staging");
  });
  it("names the tester only when Jira can't show them as reporter", () => {
    expect(bugText(ctx)).not.toContain("Reported by");
    expect(bugText({ ...ctx, reportedBy: "Priya Shah" }).split("\n")[0]).toBe("Reported by: Priya Shah (via Flaw Patrol)");
    expect(JSON.stringify(bugAdf({ ...ctx, reportedBy: "Priya Shah" }))).toContain("Priya Shah (via Flaw Patrol)");
  });
  it("builds a valid ADF document", () => {
    const doc = bugAdf(ctx) as { type: string; content: { type: string; content?: unknown[] }[] };
    expect(doc.type).toBe("doc");
    const list = doc.content.find((n) => n.type === "orderedList");
    expect(list?.content).toHaveLength(3);
    // ADF rejects empty text nodes.
    expect(JSON.stringify(doc)).not.toContain('"text":""');
  });
});

describe("parseIssueKey", () => {
  it("reads keys and browse links", () => {
    expect(parseIssueKey("qa-12")).toBe("QA-12");
    expect(parseIssueKey("https://acme.atlassian.net/browse/SHOP-881")).toBe("SHOP-881");
    expect(parseIssueKey("login fails")).toBeNull();
  });
});

describe("I saw it again in Jira (ver_126)", () => {
  const a = {
    id: "a1",
    heading: "Repro history",
    source: "table" as const,
    text: "",
    columns: [
      { name: "Date", fill: "write" as const },
      { name: "Repros", fill: "write" as const },
    ],
    rows: [["1 Nov", "3/3"], ["2 Nov", "1/3"]],
    growing: true,
  };
  const cellText = (row: Record<string, unknown>) => JSON.stringify(row);
  const fromJira = () => {
    const first = answersAdf([{ ...a, rows: [["1 Nov", "3/3"]] }], { trace: { label: "run R1", link: "https://tm.example/r/1" } }) as { content: Record<string, unknown>[] };
    // Someone edits the bug in Jira: a note at the top.
    first.content.unshift({ type: "paragraph", content: [{ type: "text", text: "Edited in Jira: only on iPad" }] });
    return first;
  };

  it("adds one row to that table and keeps everything else as Jira has it", () => {
    const before = fromJira();
    const after = addRowToAdf(before, a, ["2 Nov", "1/3"]) as { content: Record<string, unknown>[] };
    expect(after.content).toHaveLength(before.content.length);
    expect(JSON.stringify(after.content[0])).toContain("Edited in Jira: only on iPad");
    expect(JSON.stringify(after.content.at(-1))).toContain("https://tm.example/r/1");
    const table = after.content.find((n) => n.type === "table") as { content: Record<string, unknown>[] };
    expect(table.content).toHaveLength(3);
    expect(cellText(table.content[2])).toContain("1/3");
    // The original isn't changed in place.
    expect((before.content.find((n) => n.type === "table") as { content: unknown[] }).content).toHaveLength(2);
  });

  it("finds the table by its column names when the heading was renamed in Jira", () => {
    const before = fromJira();
    const i = before.content.findIndex((n) => n.type === "table");
    before.content[i - 1] = { type: "paragraph", content: [{ type: "text", text: "History" }] };
    const after = addRowToAdf(before, a, ["2 Nov", "1/3"]) as { content: Record<string, unknown>[] };
    expect((after.content[i] as { content: unknown[] }).content).toHaveLength(3);
  });

  it("puts the heading and table back above the Flaw Patrol line when the table was taken out", () => {
    const before = fromJira();
    const kept = before.content.filter((n) => n.type !== "table");
    const after = addRowToAdf({ ...before, content: kept }, a, ["2 Nov", "1/3"]) as { content: Record<string, unknown>[] };
    expect(JSON.stringify(after.content[0])).toContain("Edited in Jira");
    expect(after.content.at(-2)?.type).toBe("table");
    expect(JSON.stringify(after.content.at(-1))).toContain("Filed from Flaw Patrol");
    expect(addRowToAdf(null, a, ["2 Nov", "1/3"])).toMatchObject({ type: "doc", content: [{ type: "paragraph" }, { type: "table" }] });
  });
});
