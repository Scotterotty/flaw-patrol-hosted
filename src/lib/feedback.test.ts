import { describe, expect, it } from "vitest";
import { areaOf, browserName, feedbackInput, safeFeedbackPath } from "./feedback";

describe("Feedback", () => {
  it("names the area a page belongs to", () => {
    expect(areaOf("/p/OKO/runs/12/execute?entry=3")).toBe("Test runs");
    expect(areaOf("/p/OKO/bashes/abc")).toBe("Bug bashes");
    expect(areaOf("/g/u1/cases")).toBe("Test cases");
    expect(areaOf("/p/OKO")).toBe("Overview");
    expect(areaOf("/")).toBe("Projects");
    expect(areaOf("/whatever")).toBe("Other pages");
  });
  it("keeps only paths inside Flaw Patrol", () => {
    expect(safeFeedbackPath("/p/OKO/runs")).toBe("/p/OKO/runs");
    expect(safeFeedbackPath("//evil.example")).toBe("");
    expect(safeFeedbackPath("https://evil.example")).toBe("");
    expect(safeFeedbackPath("/\\evil.example")).toBe("");
  });
  it("names the browser in plain words", () => {
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).toBe("Safari on Mac");
  });
  it("needs a kind", () => {
    expect(feedbackInput.safeParse({ message: "hi" }).success).toBe(false);
    expect(feedbackInput.parse({ kind: "idea", message: " hi " }).message).toBe("hi");
  });
});
