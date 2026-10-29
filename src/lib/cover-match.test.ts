import { describe, expect, it } from "vitest";
import { keyWords, mightCover } from "./cover-match";

describe("mightCover", () => {
  const cases = [
    { title: "[UNITY] - Hub - Test run progress bar" },
    { title: "Sign in with a password" },
    { title: "Run list shows tester progress" },
  ];
  it("skips filler words and bracket tags", () => {
    expect([...keyWords("[WEB] - Make the new test run work")]).toEqual(["run"]);
  });
  it("finds cases sharing two words, best first", () => {
    expect(mightCover("Show each tester's progress in the run list", cases).map((m) => m.c.title)).toEqual(["Run list shows tester progress", "[UNITY] - Hub - Test run progress bar"]);
  });
  it("treats plurals as the same word", () => {
    expect(mightCover("Join a space from an invite link", [{ title: "Invite links expire after 7 days" }]).length).toBe(1);
  });
  it("strict needs half the typed words", () => {
    expect(mightCover("Progress bar colors, sizes, labels, animation, spacing", cases, { strict: true })).toEqual([]);
  });
});
