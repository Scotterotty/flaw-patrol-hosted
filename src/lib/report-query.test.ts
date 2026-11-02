import { describe, expect, it } from "vitest";
import { cleanReportQuery } from "./report-query";

describe("cleanReportQuery", () => {
  it("keeps report filters in a fixed order and drops the rest", () => {
    expect(cleanReportQuery("?tester=Sam&view=trends&evil=1&suite=&priority=HIGH")).toBe("view=trends&priority=HIGH");
    expect(cleanReportQuery({ view: "status", from: "2026-10-01", junk: "x" })).toBe("view=status&from=2026-10-01");
    expect(cleanReportQuery("")).toBe("");
  });
});
