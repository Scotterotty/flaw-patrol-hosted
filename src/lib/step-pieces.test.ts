import { describe, expect, it } from "vitest";
import { matcherFor, splitTerms } from "@/lib/glossary";
import { stepPieces } from "./step-pieces";

const terms = [
  { id: "rc", term: "RC", slug: "rc", aliases: ["release candidate"], meaning: "The build we might ship." },
  { id: "sku", term: "SKU", slug: "sku", aliases: [], meaning: "One product in the store." },
];

/** What StepText underlines: glossary terms found in the plain text pieces only. */
function underlined(text: string, marks?: string[]) {
  const matcher = matcherFor(terms);
  const seen = new Set<string>();
  return stepPieces(text, marks).flatMap((p) => (p.kind === "text" ? splitTerms(p.text, matcher, seen) : [])).flatMap((p) => (typeof p === "string" ? [] : [p.text]));
}

describe("stepPieces", () => {
  it("keeps links, test data values and plain text apart, in order", () => {
    expect(stepPieces("Open https://example.com/a and buy SKU-42", ["SKU-42"])).toEqual([
      { kind: "text", text: "Open " },
      { kind: "link", text: "https://example.com/a" },
      { kind: "text", text: " and buy " },
      { kind: "value", text: "SKU-42" },
      { kind: "text", text: "" },
    ]);
  });

  it("underlines glossary terms in a step that also has test data values", () => {
    expect(underlined("Install the RC and sign in as alice@example.com", ["alice@example.com"])).toEqual(["RC"]);
  });

  it("underlines terms in a step with no test data", () => {
    expect(underlined("Install the release candidate")).toEqual(["release candidate"]);
  });

  it("never underlines inside a test data value or a link", () => {
    expect(underlined("Search for RC", ["RC"])).toEqual([]);
    expect(underlined("Open https://example.com/RC")).toEqual([]);
  });

  it("ignores empty test data values", () => {
    expect(stepPieces("Install the RC", ["", "  "])).toEqual([{ kind: "text", text: "Install the RC" }]);
  });
});
