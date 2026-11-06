import { describe, expect, it } from "vitest";
import { JIRA_FILE_LIMIT, jiraFileLimit, leftOutNote, mbText, tooBigForJira, tooBigLine } from "./jira-files";

const MB = 1024 * 1024;

describe("files too big for Jira (ver_185)", () => {
  it("uses 24 MB unless Jira reports less", () => {
    expect(JIRA_FILE_LIMIT).toBe(24 * MB);
    expect(jiraFileLimit(undefined)).toBe(24 * MB);
    expect(jiraFileLimit(0)).toBe(24 * MB);
    expect(jiraFileLimit(1024 * MB)).toBe(24 * MB);
    expect(jiraFileLimit(10 * MB)).toBe(10 * MB);
  });

  it("flags only files over the limit, and only when the size is known", () => {
    expect(tooBigForJira(24 * MB)).toBe(false);
    expect(tooBigForJira(24 * MB + 1)).toBe(true);
    expect(tooBigForJira(undefined)).toBe(false);
    expect(tooBigForJira(11 * MB, 10 * MB)).toBe(true);
  });

  it("says sizes plainly", () => {
    expect(mbText(24 * MB)).toBe("24 MB");
    expect(mbText(31.4 * MB)).toBe("31.4 MB");
    expect(tooBigLine()).toBe("Too big for Jira (24 MB max). Record a shorter clip, or file without it.");
  });

  it("tells the filer which files stayed behind, or nothing", () => {
    expect(leftOutNote("OB-1", [], [])).toBeNull();
    expect(leftOutNote("OB-1", [{ fileName: "clip.webm", size: 31 * MB }], [])).toBe("OB-1 was created. clip.webm (31 MB) is too big for Jira (24 MB max), so it stayed in Flaw Patrol.");
    expect(leftOutNote("OB-1", [], [{ fileName: "a.png", why: "Jira said: no" }])).toBe("OB-1 was created. Jira didn't take a.png (Jira said: no).");
  });
});
