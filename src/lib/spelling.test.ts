import { describe, expect, it } from "vitest";
import { longDate, spell, spellingFor } from "./spelling";

describe("spell", () => {
  it("leaves American text alone for American readers", () => {
    expect(spell("Accent color and gray text", "us")).toBe("Accent color and gray text");
  });
  it("swaps whole words for British readers, keeping case", () => {
    expect(spell("Accent color · Gray · COLORS · Organize folders · Canceled: 2", "uk")).toBe("Accent colour · Grey · COLOURS · Organise folders · Cancelled: 2");
    expect(spell("Centered text in the center", "uk")).toBe("Centred text in the centre");
    expect(spell("Results Flaw Patrol doesn't recognize", "uk")).toBe("Results Flaw Patrol doesn't recognise");
    expect(spell("Analyze the dialog", "uk")).toBe("Analyse the dialogue");
  });
  it("doesn't touch parts of words or CSS-ish names", () => {
    expect(spell("Colorado discolor grayscale", "uk")).toBe("Colorado discolor grayscale");
  });
});

describe("spellingFor", () => {
  it("uses your pick, else American", () => {
    expect(spellingFor("uk")).toBe("uk");
    expect(spellingFor("us")).toBe("us");
    expect(spellingFor(null)).toBe("us");
    expect(spellingFor("fr")).toBe("us");
  });
});

describe("dates", () => {
  it("follows the spelling", () => {
    const d = new Date(2026, 9, 24, 15, 5);
    expect(longDate(d, "us")).toBe("Oct 24, 2026");
    expect(longDate(d, "uk")).toBe("24 Oct 2026");
  });
});
