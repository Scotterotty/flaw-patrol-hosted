import { describe, expect, it } from "vitest";
import { splitNumberedSteps } from "./numbered-steps";

describe("splitNumberedSteps", () => {
  it("splits steps typed on one line", () => {
    const t = "1. Log into and enter a space on OKO Unreal and OKO Web. 2. Add an OKO Space Entity into the space on Unreal. 3. Notice that the comment loads infinitely.";
    expect(splitNumberedSteps(t)).toEqual([
      "Log into and enter a space on OKO Unreal and OKO Web.",
      "Add an OKO Space Entity into the space on Unreal.",
      "Notice that the comment loads infinitely.",
    ]);
  });

  it("handles steps already on their own lines, and 1) style", () => {
    expect(splitNumberedSteps("1. Open\n2. Click\n3. Look")).toEqual(["Open", "Click", "Look"]);
    expect(splitNumberedSteps("1) Open 2) Click")).toEqual(["Open", "Click"]);
  });

  it("goes past ten steps and ignores numbers out of order", () => {
    const t = Array.from({ length: 12 }, (_, i) => `${i + 1}. Step ${i + 1} at 9. ok`).join(" ");
    const s = splitNumberedSteps(t)!;
    expect(s).toHaveLength(12);
    expect(s[0]).toBe("Step 1 at 9. ok");
    expect(s[11]).toBe("Step 12 at 9. ok");
  });

  it("leaves other text alone", () => {
    expect(splitNumberedSteps("Open the app. Then click Save.")).toBeNull();
    expect(splitNumberedSteps("1. Only one step")).toBeNull();
    expect(splitNumberedSteps("Version 2. is broken 3. times")).toBeNull();
    expect(splitNumberedSteps("1. Open 2.")).toBeNull();
  });
});

describe("steps sent to Jira", () => {
  it("become a numbered list even when typed on one line", async () => {
    const { richText } = await import("./jira-format");
    const doc = richText("1. Open the space. 2. Add a comment.\n\nSeen on Web only.") as { content: { type: string; content?: unknown[] }[] };
    expect(doc.content.map((c) => c.type)).toEqual(["orderedList", "paragraph"]);
    expect(doc.content[0].content).toHaveLength(2);
    expect(JSON.stringify(doc.content[0])).toContain("Add a comment.");
  });
});
