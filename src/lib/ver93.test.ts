import { describe, expect, it } from "vitest";
import { phaseOf, similarBugs } from "./bash";
import { applyOrder, moveItem, parseNavOrder } from "./nav-order";
import { comparisonFor, isRegression, type PastResult } from "./regression";
import { defaultAction, guessRisk, riskLevel } from "./risk";

const past = (status: PastResult["status"], release: string, day: number): PastResult => ({
  id: `${release}-${day}`,
  status,
  at: new Date(2026, 9, day),
  release,
  build: "",
  runNumber: day,
  runName: `Run ${day}`,
  projectKey: "WEB",
  platform: "Web",
  entryId: "e",
  caseVersion: 1,
  tester: "Dana",
  stepStatuses: [],
});

describe("regression flag", () => {
  it("compares with the last RC and flags a pass that now fails", () => {
    const against = comparisonFor([past("PASSED", "RC 21", 10), past("FAILED", "RC 20", 5)], "RC 22", "last-rc");
    expect(against?.release).toBe("RC 21");
    expect(isRegression("FAILED", against, { flaky: false, off: false, on: true })).toBe(true);
    expect(isRegression("FAILED", against, { flaky: true, off: false, on: true })).toBe(false);
    expect(isRegression("PASSED", against, { flaky: false, off: false, on: true })).toBe(false);
  });
});

describe("nav order", () => {
  it("keeps unknown links in their usual spot", () => {
    expect(applyOrder(["a", "b", "new", "c"], (x) => x, ["c", "a", "b"])).toEqual(["c", "a", "new", "b"]);
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(parseNavOrder("junk")).toEqual({ sections: {}, cycles: [] });
  });
});

describe("bug bash", () => {
  it("knows its phase", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const at = (m: number) => new Date(now.getTime() + m * 60_000);
    expect(phaseOf({ startsAt: at(10), endsAt: at(70), endedAt: null, wrappedAt: null }, now)).toBe("scheduled");
    expect(phaseOf({ startsAt: at(-10), endsAt: at(50), endedAt: null, wrappedAt: null }, now)).toBe("live");
    expect(phaseOf({ startsAt: at(-10), endsAt: at(50), endedAt: at(-1), wrappedAt: null }, now)).toBe("ended");
    expect(phaseOf({ startsAt: at(-90), endsAt: at(-30), endedAt: null, wrappedAt: at(-5) }, now)).toBe("wrapped");
  });
  it("finds bugs that sound the same", () => {
    const items = [{ text: "Order placed twice after reconnecting" }, { text: "Logo is blurry" }];
    expect(similarBugs("order gets placed twice", items)).toEqual([items[0]]);
  });
});

describe("risk board", () => {
  it("guesses from priority, points, bugs and missing tests", () => {
    const g = guessRisk({ priority: "Highest", points: 8, cases: 0, pastBugs: 0, failing: false });
    expect(g.impact).toBe(3);
    expect(g.likelihood).toBe(3);
    expect(g.reasons).toContain("No tests yet");
    const calm = guessRisk({ priority: "Low", points: 1, cases: 4, pastBugs: 0, failing: false });
    expect([calm.likelihood, calm.impact]).toEqual([1, 1]);
    expect(riskLevel(3, 3)).toBe("High");
    expect(riskLevel(1, 3)).toBe("Med");
    expect(riskLevel(1, 1)).toBe("Low");
    expect(defaultAction("High", 0)).toBe("charter");
    expect(defaultAction("Low", 0)).toBe("skip");
    expect(defaultAction("Low", 2)).toBe("run");
  });
});
