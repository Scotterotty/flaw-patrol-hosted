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

  it("handles 1). 1.) 1: 1 - and Step 1: styles", () => {
    const t =
      "1). Open a tab and log into OKO web 2). Leave the first tab open and open a second tab/window 3). Open OKO web in the second tab (same environment and tenant) 4). Log out of OKO in the second tab 5). Log back into OKO with the same user as step 1 again 6). Wait for the access token refresh in the first tab (refresh time is 30 minutes on dev) 7). Wait another minute for the maintenance window polling in OKO web to make the next request 8). Observe that CSP will try to refresh the access token, which will fail with an \"Authentication refresh flow did not match the refresh token\" error";
    const s = splitNumberedSteps(t)!;
    expect(s).toHaveLength(8);
    expect(s[0]).toBe("Open a tab and log into OKO web");
    expect(s[4]).toBe("Log back into OKO with the same user as step 1 again");
    expect(s[7]).toMatch(/^Observe that CSP/);
    expect(splitNumberedSteps("1.) Open 2.) Click")).toEqual(["Open", "Click"]);
    expect(splitNumberedSteps("1: Open 2: Click")).toEqual(["Open", "Click"]);
    expect(splitNumberedSteps("1 - Open 2 - Click")).toEqual(["Open", "Click"]);
    expect(splitNumberedSteps("1- Open\n2- Click")).toEqual(["Open", "Click"]);
    expect(splitNumberedSteps("Step 1: Open Step 2: Click")).toEqual(["Open", "Click"]);
    expect(splitNumberedSteps("step 1. Open\nStep 2. Click")).toEqual(["Open", "Click"]);
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
    expect(splitNumberedSteps("1). Open 2) Click")).toBeNull();
    expect(splitNumberedSteps("1 - 2 apples")).toBeNull();
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

  it("include 1). style steps", async () => {
    const { richText } = await import("./jira-format");
    const doc = richText("1). Open a tab 2). Log out 3). Log in") as { content: { type: string; content?: unknown[] }[] };
    expect(doc.content[0].type).toBe("orderedList");
    expect(doc.content[0].content).toHaveLength(3);
  });
});
