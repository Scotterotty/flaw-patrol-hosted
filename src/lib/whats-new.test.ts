import { describe, expect, it } from "vitest";
import { WHATS_NEW, type WhatsNewEntry } from "@/content/whats-new";
import { entriesFor, shortDate, unseenFor } from "./whats-new";

const E: WhatsNewEntry[] = [80, 81, 82, 83, 84, 85, 86].map((v) => ({
  version: v,
  date: "2026-10-28",
  items: [
    { kind: "new", title: `v${v} for all`, link: "/g/{umbrella}" },
    { kind: "fix", title: `v${v} for leads`, who: "lead" },
    { kind: "better", title: `v${v} game`, game: true },
  ],
}));
const tester = { role: "all" as const, game: false, umbrella: "u1" };

describe("What's new", () => {
  it("shows nothing once this build is seen", () => {
    expect(unseenFor(86, tester, E, 86)).toEqual([]);
  });
  it("shows only the versions after the one last closed, newest first", () => {
    expect(unseenFor(84, tester, E, 86).map((e) => e.version)).toEqual([86, 85]);
  });
  it("shows at most 5 versions for someone who never saw it", () => {
    expect(unseenFor(null, tester, E, 86).map((e) => e.version)).toEqual([86, 85, 84, 83, 82]);
  });
  it("never lists versions newer than this build", () => {
    expect(unseenFor(null, tester, E, 83)[0].version).toBe(83);
  });
  it("filters by role and the mini game, and fills in the umbrella link", () => {
    const [v] = entriesFor(tester, E, 86);
    expect(v.items.map((i) => i.title)).toEqual(["v86 for all"]);
    expect(v.items[0].link).toBe("/g/u1");
    const lead = entriesFor({ role: "lead", game: true, umbrella: null }, E, 86)[0];
    expect(lead.items.map((i) => i.title)).toEqual(["v86 for all", "v86 for leads", "v86 game"]);
    expect(lead.items[0].link).toBeUndefined();
  });
  it("skips a version with nothing for this person", () => {
    const only: WhatsNewEntry[] = [{ version: 86, date: "2026-10-28", items: [{ kind: "new", title: "admins", who: "admin" }] }];
    expect(unseenFor(null, tester, only, 86)).toEqual([]);
  });
  it("keeps Workspace settings items for workspace admins", () => {
    const ws: WhatsNewEntry[] = [{ version: 92, date: "2026-10-28", items: [{ kind: "new", title: "ws", who: "workspace" }, { kind: "new", title: "admins", who: "admin" }] }];
    expect(entriesFor({ role: "admin", game: false, umbrella: null }, ws, 92)[0].items.map((i) => i.title)).toEqual(["admins"]);
    expect(entriesFor({ role: "workspace", game: false, umbrella: null }, ws, 92)[0].items.map((i) => i.title)).toEqual(["ws", "admins"]);
  });
  it("writes dates the person's way", () => {
    expect(shortDate("2026-10-28")).toBe("Oct 28");
    expect(shortDate("2026-10-28", "uk")).toBe("28 Oct");
  });
  it("has one entry per version, newest on top, with no British spellings", () => {
    const versions = WHATS_NEW.map((e) => e.version);
    expect(versions).toEqual([...versions].sort((a, b) => b - a));
    expect(JSON.stringify(WHATS_NEW)).not.toMatch(/colour|grey|centre|organis|recognis/i);
  });
});
