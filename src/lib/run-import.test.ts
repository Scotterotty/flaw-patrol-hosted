import { describe, expect, it } from "vitest";
import { caseOutcome, guessColumns, matchTester, readSheet, readStatus } from "./run-import";

const header = ["Key", "Name", "Description", "Precondition", "Step Order", "Step Description", "Expected Result", "58.70%", "Executed By", "Status", "Defects", "Priority", "Folder"];
const row = (key: string, name: string, step: string, caseStatus: string, by: string, status: string, defects = "") => [key, name, "", "", step, "Do it", "", caseStatus, by, status, defects, "", ""];

describe("importing a run from a sheet", () => {
  it("finds the columns, including a case result under a pass-rate header", () => {
    expect(guessColumns(header)).toEqual({ key: 0, title: 1, step: 4, caseStatus: 7, tester: 8, stepStatus: 9, defects: 10 });
  });

  it("reads status words loosely", () => {
    expect(readStatus("Passed").status).toBe("PASSED");
    expect(readStatus(" pass ").status).toBe("PASSED");
    expect(readStatus("N/A").status).toBe("SKIPPED");
    expect(readStatus("—")).toEqual({ status: "UNTESTED", known: true });
    expect(readStatus("Maybe")).toEqual({ status: "UNTESTED", known: false });
  });

  it("groups step rows under the case that starts them", () => {
    const { cases } = readSheet(
      [row("PQ-1", "Login", "1.1", "Passed", "Ryan", "Passed"), row("", "", "1.2", "", "", "Passed", "PROJ-7, PROJ-8"), row("PQ-2", "Chat", "1.1", "Untested", "—", "Untested")],
      guessColumns(header),
    );
    expect(cases.map((c) => [c.key, c.tester, c.steps.length, c.caseStatus])).toEqual([
      ["PQ-1", "Ryan", 2, "PASSED"],
      ["PQ-2", "", 1, "UNTESTED"],
    ]);
    expect(cases[0].defects).toEqual(["PROJ-7", "PROJ-8"]);
  });

  it("works out the case result, leaving part-done cases in progress", () => {
    const c = (caseStatus: string | null, steps: string[]) => ({ row: 2, key: "PQ-1", title: "", tester: "", defects: [], caseStatus: caseStatus as never, steps: steps.map((s) => ({ status: s as never, actual: "" })) });
    expect(caseOutcome(c("BLOCKED", ["BLOCKED"]), 1)).toBe("BLOCKED");
    expect(caseOutcome(c("UNTESTED", ["PASSED", "UNTESTED"]), 2)).toBe("IN_PROGRESS");
    expect(caseOutcome(c(null, ["PASSED", "FAILED"]), 2)).toBe("FAILED");
    expect(caseOutcome(c(null, ["UNTESTED"]), 1)).toBe("UNTESTED");
  });

  it("matches testers by name, first name, short name or a remembered link", () => {
    const members = [
      { id: "1", name: "Ryan Lee", email: "ryan@x.com" },
      { id: "2", name: "Jordan Park", email: "jp@x.com" },
      { id: "3", name: "Jessica Ruiz", email: "jess@x.com" },
      { id: "4", name: "Jessie Moon", email: "jm@x.com" },
    ];
    expect(matchTester("Ryan", members)?.id).toBe("1");
    expect(matchTester("Jord", members)?.id).toBe("2");
    expect(matchTester("jess", members)?.id).toBe("3");
    expect(matchTester("Jes", members)).toBeNull();
    expect(matchTester("JR", members, { jr: "3" })?.id).toBe("3");
  });
});
