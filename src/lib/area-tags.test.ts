import { describe, expect, it } from "vitest";
import { applyAreaWord, areaCandidate, findAreaWords } from "./area-tags";

const ctx = { platforms: ["Unity", "Web"], known: ["Unity", "Web", "Spaces", "smoke"], skip: ["Lobby"] };

describe("areaCandidate", () => {
  it("takes a known tag after the platform", () => {
    expect(areaCandidate("Spaces Deep Link", ["Unity"], ctx)).toEqual({ word: "Spaces", rest: "Deep Link", known: true });
    expect(areaCandidate("spaces - Deep Link", ["Unity"], ctx)).toEqual({ word: "Spaces", rest: "Deep Link", known: true });
  });
  it("takes one or two words before a dash", () => {
    expect(areaCandidate("Hub - Space List", ["Web"], ctx)).toEqual({ word: "Hub", rest: "Space List", known: false });
    expect(areaCandidate("Main Menu: Quit", ["Web"], ctx)).toEqual({ word: "Main Menu", rest: "Quit", known: false });
  });
  it("leaves titles alone without a platform, action words, skipped words and plain titles", () => {
    expect(areaCandidate("Hub - Space List", ["smoke"], ctx)).toBeNull();
    expect(areaCandidate("Verify - login", ["Unity"], ctx)).toBeNull();
    expect(areaCandidate("Lobby - Join friend", ["Unity"], ctx)).toBeNull();
    expect(areaCandidate("Deep Link opens the app", ["Unity"], ctx)).toBeNull();
    expect(areaCandidate("Spacesuit - Equip", ["Unity"], ctx)).toEqual({ word: "Spacesuit", rest: "Equip", known: false });
    expect(areaCandidate("Spaces", ["Unity"], ctx)).toBeNull();
    expect(areaCandidate("Spaces Deep Link", ["Unity", "Spaces"], ctx)).toBeNull();
    expect(areaCandidate("2024 - Release", ["Unity"], ctx)).toBeNull();
  });
});

describe("findAreaWords", () => {
  it("needs 3 cases for a new word, 1 for a known one", () => {
    const cases = [
      { title: "Spaces Deep Link", tags: ["Unity"] },
      { title: "Hub - A", tags: ["Unity"] },
      { title: "Hub - B", tags: ["Web"] },
      { title: "Hub - C", tags: ["Unity"] },
      { title: "Store - Buy", tags: ["Unity"] },
    ];
    expect(findAreaWords(cases, ctx).map((w) => [w.word, w.count, w.known])).toEqual([
      ["Hub", 3, false],
      ["Spaces", 1, true],
    ]);
  });
});

describe("applyAreaWord", () => {
  it("moves only accepted words", () => {
    expect(applyAreaWord("hub - Space List", ["Unity"], ["Hub"], ctx)).toEqual({ title: "Space List", tags: ["Unity", "Hub"] });
    expect(applyAreaWord("Store - Buy", ["Unity"], ["Hub"], ctx)).toBeNull();
  });
});
