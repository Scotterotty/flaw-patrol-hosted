import { describe, expect, it } from "vitest";
import { parseCaseSort, sortCases } from "./case-sort";

const cases = [
  { id: "a", priority: "LOW" },
  { id: "b", priority: "CRITICAL" },
  { id: "c", priority: "MEDIUM" },
  { id: "d", priority: "CRITICAL" },
  { id: "e", priority: "HIGH" },
] as const;

describe("sortCases", () => {
  it("puts the highest priority first and keeps suite order within a priority", () => {
    expect(sortCases(cases, "priority", (c) => c.priority).map((c) => c.id)).toEqual(["b", "d", "e", "c", "a"]);
  });
  it("leaves the order alone otherwise, without changing the input", () => {
    const out = sortCases(cases, "order", (c) => c.priority);
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(out).not.toBe(cases);
  });
  it("defaults anything unknown to suite order", () => {
    expect(parseCaseSort("priority")).toBe("priority");
    expect(parseCaseSort("nonsense")).toBe("order");
    expect(parseCaseSort(undefined)).toBe("order");
  });
  it("sorts runs by status, open work first, and leaves suites (no statuses) alone", () => {
    const rows = [
      { id: "p", priority: "LOW", status: "PASSED" },
      { id: "u", priority: "LOW", status: "UNTESTED" },
      { id: "f", priority: "LOW", status: "FAILED" },
      { id: "i", priority: "LOW", status: "IN_PROGRESS" },
      { id: "u2", priority: "LOW", status: "UNTESTED" },
    ] as const;
    expect(sortCases(rows, "status", (r) => r.priority, (r) => r.status).map((r) => r.id)).toEqual(["i", "u", "u2", "f", "p"]);
    expect(sortCases(rows, "status", (r) => r.priority).map((r) => r.id)).toEqual(["p", "u", "f", "i", "u2"]);
    expect(parseCaseSort("status")).toBe("status");
  });
});
