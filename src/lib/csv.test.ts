import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(toCsv([["a,b", 'say "hi"', "x\ny", 3, null]])).toBe('"a,b","say ""hi""","x\ny",3,');
  });
  it("neutralises spreadsheet formulas", () => {
    expect(toCsv([["=HYPERLINK(1)", "-5"]])).toBe("'=HYPERLINK(1),'-5");
  });
});
