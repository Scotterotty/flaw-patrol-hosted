import { describe, expect, it } from "vitest";
import { keepBug, mergePicks, readPicks, sharedFilters, switchHref } from "./bugs-view";

const me = { name: "Demo Admin", email: "admin@example.com" };
const bug = { key: "OB-1", title: "Avatar falls through floor", assignee: "Demo Admin", assigneeEmail: "admin@example.com", labels: ["Physics"], priority: "High", versions: ["2.4.2"], inFp: false };

describe("Bugs Table and Board in sync (ver_232)", () => {
  it("reads saved picks and leaves out anything odd", () => {
    expect(readPicks(null)).toEqual({});
    expect(readPicks({ view: "board", found: false, boards: { OB: "12", BAD: 5 } })).toEqual({ view: "board", found: false, boards: { OB: "12" } });
    expect(readPicks({ view: "list", found: "yes" })).toEqual({});
  });

  it("merges a board pick per Jira project", () => {
    const one = mergePicks({}, { board: { jira: "OB", id: "12" } });
    const two = mergePicks(one, { board: { jira: "BB", id: "7" }, view: "board" });
    expect(two).toEqual({ view: "board", boards: { OB: "12", BB: "7" } });
    expect(mergePicks(two, { board: { jira: "OB", id: "not a number" } }).boards?.OB).toBe("12");
  });

  it("Found in testing comes from the web address, then the saved pick, then on", () => {
    expect(sharedFilters({}, {}).found).toBe(true);
    expect(sharedFilters({}, { found: false }).found).toBe(false);
    expect(sharedFilters({ found: "1" }, { found: false }).found).toBe(true);
    expect(sharedFilters({ found: "all" }, {}).found).toBe(false);
  });

  it("keeps a bug by the shared filters", () => {
    const f = sharedFilters({ found: "all" }, {});
    expect(keepBug(bug, f, me)).toBe(true);
    expect(keepBug(bug, { ...f, found: true }, me)).toBe(false);
    expect(keepBug(bug, { ...f, mine: true }, me)).toBe(true);
    expect(keepBug(bug, { ...f, mine: true }, { name: "Jordan Lee", email: "jordan@example.com" })).toBe(false);
    expect(keepBug(bug, { ...f, label: "Physics", priority: "High", version: "2.4.2" }, me)).toBe(true);
    expect(keepBug(bug, { ...f, priority: "Low" }, me)).toBe(false);
    expect(keepBug(bug, { ...f, q: "avatar ob-1" }, me)).toBe(true);
    expect(keepBug(bug, { ...f, q: "lobby" }, me, { search: false })).toBe(true);
  });

  it("the Table | Board switch keeps every filter and the board", () => {
    expect(switchHref("view=table&board=8&q=crash&found=all", "board")).toBe("?view=board&board=8&q=crash&found=all");
    expect(switchHref("", "table")).toBe("?view=table");
  });
});
