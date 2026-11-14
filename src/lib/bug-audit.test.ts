import { describe, expect, it } from "vitest";
import { aboutPlatform, auditComment, CLAIM_MS, LABEL_LAG_MS, reopenedChecks, claimLive, fieldChanges, pace, parseFilterInput, pickNext, type AuditClaim, type AuditIssue } from "./bug-audit";

const bug = (key: string, title: string, components: string[] = [], labels: string[] = []): AuditIssue => ({ key, title, status: "Ready for Development", priority: "Low", components, labels, created: "2024-01-01" });
const now = new Date("2026-11-14T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const claim = (issueKey: string, by: string | null, at: Date | null, checkedAt: Date | null = null): AuditClaim => ({ issueKey, claimedById: by, claimedBy: by ?? "", claimedAt: at, checkedAt });

describe("parseFilterInput", () => {
  it("takes a Jira filter link or number", () => {
    expect(parseFilterInput("https://magnopus.atlassian.net/issues/?filter=23539")).toEqual({ jql: "filter = 23539", filterId: "23539" });
    expect(parseFilterInput("https://magnopus.atlassian.net/jira/filters/23539")).toEqual({ jql: "filter = 23539", filterId: "23539" });
    expect(parseFilterInput(" 23539 ")).toEqual({ jql: "filter = 23539", filterId: "23539" });
  });
  it("takes JQL as it is, and refuses other links and blanks", () => {
    expect(parseFilterInput('project = OB AND labels != 2026audit')).toEqual({ jql: "project = OB AND labels != 2026audit", filterId: null });
    expect(parseFilterInput("https://example.com/somewhere")).toBeNull();
    expect(parseFilterInput("  ")).toBeNull();
  });
});

describe("aboutPlatform", () => {
  it("finds the platform in the summary, components or labels, as a whole word", () => {
    expect(aboutPlatform(bug("OB-1", "UE4: Pagination params missing"), "Unreal")).toBe(true);
    expect(aboutPlatform(bug("OB-2", "[UNITY] Scripts referencing triggers"), "Unity")).toBe(true);
    expect(aboutPlatform(bug("OB-3", "Display names blur", ["Web Client"]), "Web")).toBe(true);
    expect(aboutPlatform(bug("OB-4", "Webhooks fail"), "Web")).toBe(false);
    expect(aboutPlatform(bug("OB-5", "Anything"), "")).toBe(true);
  });
});

describe("claimLive", () => {
  it("lasts 15 minutes and ends once the bug is checked", () => {
    expect(claimLive(claim("OB-1", "u1", ago(CLAIM_MS - 1000)), now)).toBe(true);
    expect(claimLive(claim("OB-1", "u1", ago(CLAIM_MS + 1000)), now)).toBe(false);
    expect(claimLive(claim("OB-1", "u1", ago(1000), ago(500)), now)).toBe(false);
    expect(claimLive(claim("OB-1", null, null), now)).toBe(false);
  });
});

describe("pickNext", () => {
  const issues = [bug("OB-1", "UE4 crash"), bug("OB-2", "Unity camera"), bug("OB-3", "Web login"), bug("OB-4", "Unity lights")];
  it("hands out the first bug nobody holds, in the filter's order", () => {
    const claims = new Map([["OB-1", claim("OB-1", "u2", ago(1000))]]);
    expect(pickNext(issues, claims, "me", now)?.key).toBe("OB-2");
  });
  it("gives back a bug you already hold first", () => {
    const claims = new Map([["OB-3", claim("OB-3", "me", ago(1000))]]);
    expect(pickNext(issues, claims, "me", now)?.key).toBe("OB-3");
  });
  it("frees an old claim, skips checked bugs, and follows the platform pick", () => {
    const claims = new Map([
      ["OB-1", claim("OB-1", "u2", ago(CLAIM_MS * 2))],
      ["OB-2", claim("OB-2", "u2", ago(1000), ago(500))],
    ]);
    expect(pickNext(issues, claims, "me", now)?.key).toBe("OB-1");
    expect(pickNext(issues, claims, "me", now, { platform: "Unity" })?.key).toBe("OB-4");
    expect(pickNext(issues, claims, "me", now, { platform: "Unity" }, ["OB-4"])).toBeNull();
  });
});

describe("pace", () => {
  it("spreads what's left over the days left, at least one", () => {
    expect(pace(572, new Date("2026-11-19T12:00:00Z"), now)).toEqual({ days: 5, perDay: 115 });
    expect(pace(10, new Date("2026-11-10T00:00:00Z"), now)).toEqual({ days: 1, perDay: 10 });
    expect(pace(10, null, now)).toBeNull();
  });
});

describe("fieldChanges and auditComment", () => {
  const before = { summary: "Font missing characters", priority: "Low", components: ["UI"], versions: [] };
  it("says what changed in words", () => {
    expect(fieldChanges(before, { ...before, priority: "Medium", components: ["UI", "Avatars"] })).toEqual(["Priority: Low → Medium", "Components: UI → UI, Avatars"]);
    expect(fieldChanges(before, { ...before, components: ["UI"] })).toEqual([]);
  });
  it("writes one comment with the outcome, note, changes and checker", () => {
    expect(auditComment({ label: "2026audit", outcome: "still", clients: ["Web", "Unity"], build: "R24", note: " é and ñ vanish ", by: "Scott Smith", changes: ["Priority: Low → Medium"], movedTo: "" })).toBe(
      "Bug audit (2026audit): Still happens on Web, Unity, build R24.\nNote: é and ñ vanish\nChanged: Priority: Low → Medium.\nChecked by Scott Smith in Flaw Patrol.",
    );
    expect(auditComment({ label: "2026audit", outcome: "cant", clients: [], build: "", note: "", by: "Ryan", changes: [], movedTo: "Closed" })).toBe("Bug audit (2026audit): Can't reproduce.\nMoved to Closed.\nChecked by Ryan in Flaw Patrol.");
  });
});

describe("reopenedChecks", () => {
  it("undoes a check once the bug is back on the filter, after Jira's search has had time to catch up", () => {
    const checks = [
      { issueKey: "OB-2217", checkedAt: ago(LABEL_LAG_MS * 5) },
      { issueKey: "OB-2927", checkedAt: ago(30_000) },
      { issueKey: "OB-3185", checkedAt: ago(LABEL_LAG_MS * 5) },
      { issueKey: "OB-3510", checkedAt: null },
    ];
    expect(reopenedChecks(checks, new Set(["OB-2217", "OB-2927", "OB-3510"]), now)).toEqual(["OB-2217"]);
  });
});
