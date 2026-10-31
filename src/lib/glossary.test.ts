import { describe, expect, it } from "vitest";
import { countsForXp, findTerm, glossaryStatsFrom, letterOf, lookupText, matcherFor, parseAliases, slugOf, splitTerms, termKey, type GlossaryLite } from "./glossary";

const t = (term: string, meaning = "Some plain meaning here", aliases: string[] = []): GlossaryLite => ({ id: term, term, slug: slugOf(term), aliases, meaning });

describe("glossary names", () => {
  it("treats spacing and case as the same term", () => {
    expect(termKey("  Repro   Rate ")).toBe("repro rate");
    expect(slugOf("Repro rate")).toBe("repro-rate");
    expect(slugOf("Café · CSP!")).toBe("cafe-csp");
    expect(slugOf("!!!")).toBe("term");
  });
  it("cleans other names and drops the term itself and repeats", () => {
    expect(parseAliases("org, Workspace; org\n tenant ", "Tenant")).toEqual(["org", "Workspace"]);
  });
  it("finds a term by its name or another name, ignoring punctuation around it", () => {
    const terms = [t("Release candidate", "x", ["RC"]), t("Tenant")];
    expect(findTerm(terms, "rc,")?.term).toBe("Release candidate");
    expect(findTerm(terms, "(tenant)")?.term).toBe("Tenant");
    expect(findTerm(terms, "nope")).toBeUndefined();
  });
  it("offers Look it up for a word or short phrase only", () => {
    expect(lookupText("  tenant. ")).toBe("tenant");
    expect(lookupText("one two three four five six seven")).toBeNull();
    expect(lookupText("...")).toBeNull();
  });
  it("needs a few words before a meaning counts for XP", () => {
    expect(countsForXp("idk")).toBe(false);
    expect(countsForXp("A build that ships")).toBe(true);
  });
  it("files odd first letters under #", () => {
    expect(letterOf("élan")).toBe("E");
    expect(letterOf("3D")).toBe("#");
  });
});

describe("underlines", () => {
  const terms = [t("RC", "A build that might ship", ["release candidate"]), t("Repro rate"), t("Repro"), t("Asked only", "")];
  const m = matcherFor(terms);
  it("marks whole words only, longest name first, once each", () => {
    const parts = splitTerms("Repro rate 4/5 on RC 22, source RC and repro", m);
    const marked = parts.filter((p) => typeof p !== "string").map((p) => (typeof p === "string" ? p : p.text));
    expect(marked).toEqual(["Repro rate", "RC", "repro"]);
    expect(parts.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe("Repro rate 4/5 on RC 22, source RC and repro");
  });
  it("shares what's been marked across texts of one card", () => {
    const seen = new Set<string>();
    splitTerms("RC 1", m, seen);
    expect(splitTerms("RC 2", m, seen)).toEqual(["RC 2"]);
  });
  it("leaves unanswered questions and empty glossaries alone", () => {
    expect(splitTerms("Asked only here", m)).toEqual(["Asked only here"]);
    expect(matcherFor([])).toBeNull();
    expect(splitTerms("RC", null)).toEqual(["RC"]);
  });
  it("matches across line breaks inside a phrase", () => {
    const parts = splitTerms("a release\ncandidate build", m);
    expect(parts.some((p) => typeof p !== "string" && p.term.term === "RC")).toBe(true);
  });
});

describe("Glossary XP", () => {
  const at = new Date("2026-10-31T10:00:00Z");
  const row = (o: Partial<import("./glossary").GlossaryWorkRow>) => ({ meaning: "A build that might ship", createdById: "me", answeredById: null, createdAt: at, answeredAt: null, lookups: [], ...o });
  it("counts terms you added, questions you answered for others, and teammates' lookups up to 10 per term", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ userId: `u${i}` }));
    const s = glossaryStatsFrom(
      [
        row({ lookups: [{ userId: "me" }, { userId: "sam" }] }),
        row({ createdById: "sam", answeredById: "me", answeredAt: at, lookups: many }),
        row({ createdById: "me", answeredById: "me", answeredAt: at }),
        row({ meaning: "idk" }),
        row({ createdById: "sam" }),
        row({ createdById: "me", answeredById: "sam", answeredAt: at }),
      ],
      "me",
    );
    expect(s).toEqual({ glossaryTerm: 2, glossaryAnswer: 1, glossaryHelp: 1 + 10, glossaryLookups: 1 + 14 });
  });
  it("only counts work after an XP reset", () => {
    expect(glossaryStatsFrom([row({})], "me", new Date("2026-11-01")).glossaryTerm).toBe(0);
  });
});
