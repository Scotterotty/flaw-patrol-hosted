import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findHowTo, HOW_TO, HOW_TO_GROUPS, HOW_TO_TARGETS, howToById, isHowToQuery, showMeTasks } from "./how-to";

// Every .tsx file under src, read once.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".tsx") ? [readFileSync(p, "utf8")] : [];
  });
}
const code = sources(path.resolve(__dirname, "..")).join("\n");

describe("How-to guide", () => {
  it("has about 40 tasks, each in a known group, with unique ids", () => {
    expect(HOW_TO.length).toBeGreaterThanOrEqual(40);
    expect(new Set(HOW_TO.map((t) => t.id)).size).toBe(HOW_TO.length);
    for (const t of HOW_TO) expect(HOW_TO_GROUPS).toContain(t.group);
  });

  it("writes every task end to end: each step says what you should see", () => {
    for (const t of HOW_TO) {
      expect(t.steps.length, t.id).toBeGreaterThanOrEqual(2);
      for (const s of t.steps) expect(s.see, `${t.id}: ${s.text}`).toBeTruthy();
    }
  });

  it("points Next task at a real task", () => {
    for (const t of HOW_TO) if (t.next) expect(howToById.has(t.next), `${t.id} → ${t.next}`).toBe(true);
  });

  it("has Show me on the 12 most-used tasks", () => {
    const ids = showMeTasks().map((t) => t.id);
    for (const id of ["write-case", "import-cases", "make-suite", "create-run", "test-case", "report-bug", "write-bug", "start-bash", "search", "reports", "invite", "appearance"]) expect(ids).toContain(id);
  });

  // A renamed or removed button fails here until the guide is updated.
  it("finds every Show me target in the code", () => {
    const missing = HOW_TO_TARGETS.filter((name) => {
      if (name.startsWith("menu-")) {
        const id = name.slice(5).replace(/-plus$/, "");
        return !new RegExp(`(id|howto): "${id}"`).test(code);
      }
      return !code.includes(`"${name}"`) || !new RegExp(`data-howto=\\{?[^>]*"${name}"|howto="${name}"`).test(code);
    });
    expect(missing).toEqual([]);
  });

  // Search words may hold UK spellings so UK readers find things; what's shown is American (spell() turns it UK).
  it("uses American spelling", () => {
    const text = JSON.stringify(HOW_TO.map((t) => ({ ...t, words: "" })));
    expect(text).not.toMatch(/\b(colour|grey|organise|favourite|centre|recognise)\b/i);
  });

  it("keeps the secret extras out", () => {
    const text = JSON.stringify(HOW_TO).toLowerCase();
    for (const w of ["quests?", "quest map", "crowns?", "pawns?", "bug of war", "early adopter", "mini game", "go live"]) expect(text).not.toMatch(new RegExp(`\\b${w}\\b`));
  });

  it("finds a task from a how do I question", () => {
    expect(isHowToQuery("how do I write a bug")).toBe(true);
    expect(isHowToQuery("help")).toBe(true);
    expect(isHowToQuery("APP-12")).toBe(false);
    expect(findHowTo("how do I write a bug")[0].id).toBe("write-bug");
    expect(findHowTo("how do I import cases from excel")[0].id).toBe("import-cases");
    expect(findHowTo("how to invite someone")[0].id).toBe("invite");
    expect(findHowTo("how do I")).toHaveLength(HOW_TO.length);
  });
});
