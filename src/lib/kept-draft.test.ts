import { describe, expect, it } from "vitest";
import { KEPT_DAYS, differs, keptStamp, dropKept, keptKey, readKept, sweepKept, writeKept } from "./kept-draft";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    m,
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe("kept drafts", () => {
  it("keeps and reads back a draft per person and place", () => {
    const s = memory();
    writeKept(s, keptKey("u1", "write-bug"), { summary: "Hair flickers" }, 1000);
    expect(readKept(s, keptKey("u1", "write-bug"), 2000)).toEqual({ at: 1000, data: { summary: "Hair flickers" } });
    expect(readKept(s, keptKey("u2", "write-bug"), 2000)).toBeNull();
    expect(readKept(s, keptKey("u1", "report-bug:e1"), 2000)).toBeNull();
  });

  it(`clears a draft after ${KEPT_DAYS} days`, () => {
    const s = memory();
    const k = keptKey("u1", "x");
    writeKept(s, k, "hi", 0);
    expect(readKept(s, k, KEPT_DAYS * DAY)).not.toBeNull();
    expect(readKept(s, k, KEPT_DAYS * DAY + 1)).toBeNull();
    expect(s.m.has(k)).toBe(false);
  });

  it("sweeps only old kept drafts and leaves other storage alone", () => {
    const s = memory();
    writeKept(s, keptKey("u1", "old"), "a", 0);
    writeKept(s, keptKey("u2", "new"), "b", 9 * DAY);
    s.setItem("fp-pane:box", "300");
    sweepKept(s, 10 * DAY);
    expect([...s.m.keys()].sort()).toEqual(["fp-kept:u2:new", "fp-pane:box"]);
  });

  it("drops a draft and survives storage that throws", () => {
    const s = memory();
    const k = keptKey("u1", "x");
    writeKept(s, k, 1, 0);
    dropKept(s, k);
    expect(readKept(s, k, 0)).toBeNull();
    const broken = { ...s, getItem: () => "{nope", setItem: () => { throw new Error("full"); } };
    expect(readKept(broken, k, 0)).toBeNull();
    expect(writeKept(broken, k, 1, 0)).toBe(false);
  });

  it("only brings back drafts that differ from the empty form", () => {
    expect(differs({ a: "" }, { a: "" })).toBe(false);
    expect(differs({ a: "x" }, { a: "" })).toBe(true);
  });

  it("stamps what a form opened with, so a newer version gets a new place", () => {
    expect(keptStamp({ name: "Log in" })).toBe(keptStamp({ name: "Log in" }));
    expect(keptStamp({ name: "Log in" })).not.toBe(keptStamp({ name: "Log in as admin" }));
  });
});
