import { describe, expect, it } from "vitest";
import { adfText, fileSize, isMe, isQaColumn, pickBoard, priorityTone, shortNames, withoutOrder } from "./bug-board";

describe("bug board (ver_211)", () => {
  it("outlines the columns QA works from", () => {
    for (const n of ["Needs QA", "In test", "Ready for QA", "Verify", "Testing"]) expect(isQaColumn(n), n).toBe(true);
    for (const n of ["New", "Open / Reopen", "Ready for development", "In dev / Awaiting", "Blocked / NMI", "Latest"]) expect(isQaColumn(n), n).toBe(false);
  });

  it("picks the bug board when a project has several", () => {
    const boards = [
      { id: "1", name: "OB sprint", type: "scrum" },
      { id: "2", name: "OB board", type: "kanban" },
      { id: "3", name: "OLY Bugs", type: "kanban" },
    ];
    expect(pickBoard(boards)?.id).toBe("3");
    expect(pickBoard(boards, "1")?.id).toBe("1");
    expect(pickBoard(boards.slice(0, 2))?.id).toBe("2");
    expect(pickBoard([])).toBeNull();
  });

  it("takes ORDER BY off a board's filter", () => {
    expect(withoutOrder('project = OB AND type = Bug ORDER BY Rank ASC')).toBe("project = OB AND type = Bug");
    expect(withoutOrder("project = OB")).toBe("project = OB");
  });

  it("colors priorities, with the name always on the pill", () => {
    expect(priorityTone("Blocker")).toBe("high");
    expect(priorityTone("Highest")).toBe("high");
    expect(priorityTone("Medium")).toBe("medium");
    expect(priorityTone("Low")).toBe("low");
    expect(priorityTone("Not Prioritized")).toBe("none");
    expect(priorityTone("")).toBe("none");
  });

  it("shows first names, a last initial only for two of the same, and You", () => {
    const people = [
      { name: "Sam Rivera", email: "sam@x.com" },
      { name: "Sam Ortiz", email: "ortiz@x.com" },
      { name: "Priya Patel", email: "" },
      { name: "Demo Admin", email: "admin@example.com" },
    ];
    const name = shortNames(people, { name: "Demo Admin", email: "admin@example.com" });
    expect(name(people[0])).toBe("Sam R.");
    expect(name(people[1])).toBe("Sam O.");
    expect(name(people[2])).toBe("Priya");
    expect(name(people[3])).toBe("You");
    expect(name({ name: "", email: "" })).toBe("Unassigned");
  });

  it("knows the viewer by email, or by name when Jira hides the email", () => {
    expect(isMe({ name: "X", email: "A@x.com" }, { name: "Y", email: "a@x.com" })).toBe(true);
    expect(isMe({ name: "Demo Admin", email: "" }, { name: "demo admin", email: "a@x.com" })).toBe(true);
    expect(isMe({ name: "Demo Admin", email: "b@x.com" }, { name: "Demo Admin", email: "a@x.com" })).toBe(false);
  });

  it("writes file sizes and plain text of a Jira description", () => {
    expect(fileSize(500)).toBe("500 B");
    expect(fileSize(52_000)).toBe("51 KB");
    expect(fileSize(3 * 1024 * 1024)).toBe("3.0 MB");
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "mention", attrs: { text: "@Sam" } }] }] };
    expect(adfText(doc)).toBe("Hello @Sam");
  });
});
