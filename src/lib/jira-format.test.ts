import { describe, expect, it } from "vitest";
import { bugAdf, bugText, defaultSummary, didNot, parseIssueKey, type BugContext } from "./jira-format";

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
