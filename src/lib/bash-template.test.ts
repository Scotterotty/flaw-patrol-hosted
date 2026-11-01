import { describe, expect, it } from "vitest";
import { blankSection, type BugLayout } from "./bug-layout";
import { bashAnswers, findTemplate, mergeValues, needsOf, withoutSeenRow, withSeenRow } from "./bash-template";

const steps = { ...blankSection("text", "Steps to see it"), must: true };
const repro = blankSection("steps", "Repro steps");
const expected = blankSection("expected", "What you expected");
const actual = blankSection("actual", "What happened");
const env = blankSection("env", "Environment");
const log = { ...blankSection("file", "Crash log"), must: true, types: ".txt" };
const table = blankSection("table", "Repro history");
const layout: BugLayout = { title: { platform: false, area: true, build: false }, sections: [steps, repro, expected, actual, env, log, table], shot: true, fields: [], from: "" };
const auto = { now: "Nov 1, 2026, 5:00 AM UTC", build: "1.2.3", env: "Staging", device: "Chrome 141 · Windows", who: "Sam" };

describe("bug templates in bug bashes", () => {
  it("starts a bash bug: steps as text, env and table filled, the one line under What happened", () => {
    const a = bashAnswers(layout, { [steps.id]: { text: "1. Tap Pay", files: [] } }, { env: "Build: 1.2.3", actual: "Pay crashes" }, auto);
    expect(a.map((x) => x.source)).toEqual(["text", "text", "text", "actual", "env", "file", "table"]);
    expect(a[0].text).toBe("1. Tap Pay");
    expect(a[3].text).toBe("Pay crashes");
    expect(a[4].text).toBe("Build: 1.2.3");
    expect(a[6].rows).toHaveLength(1);
    expect(a[6].rows![0]).toContain("Sam");
  });

  it("says what's still needed, and the bug never has to wait to be logged", () => {
    const a = bashAnswers(layout, {}, { env: "", actual: "x" }, auto);
    expect(needsOf(layout, a, []).words).toEqual(["Steps to see it", "Crash log", "a screenshot or video"]);
    expect(needsOf(layout, a, [{ fileName: "shot.png" }]).words).toEqual(["Steps to see it", "Crash log"]);
    expect(needsOf(layout, a, []).ids).toEqual([steps.id, log.id]);
  });

  it("fills in on top of what's there and adds files", () => {
    const a = bashAnswers(layout, { [log.id]: { text: "", files: [{ id: "f1", fileName: "a.txt" }] } }, { env: "", actual: "x" }, auto);
    const b = mergeValues(a, layout, { [steps.id]: { text: "1. Open", files: [] }, [log.id]: { text: "", files: [{ id: "f2", fileName: "b.txt" }] }, [table.id]: { text: "nope", files: [] } });
    expect(b[0].text).toBe("1. Open");
    expect(b[5].files!.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(b[6]).toEqual(a[6]);
    expect(needsOf(layout, b, [{ fileName: "x.mp4" }]).words).toEqual([]);
  });

  it("+1 adds a row with the person's cells, and taking it back removes it", () => {
    const a = bashAnswers(layout, {}, { env: "", actual: "x" }, auto);
    const b = withSeenRow(a, { ...auto, who: "Priya" });
    expect(b[6].rows).toHaveLength(2);
    expect(withoutSeenRow(b, "Priya")[6].rows).toHaveLength(1);
    expect(withoutSeenRow(b, "Sam")[6].rows).toHaveLength(2);
  });

  it("a plain bug has no template", () => {
    expect(findTemplate({ templateName: "", layout: null, answers: null }, [])).toBeNull();
    const a = bashAnswers(layout, {}, { env: "", actual: "x" }, auto);
    expect(findTemplate({ templateName: "Crash", layout, answers: a }, [])?.needs).toHaveLength(3);
  });
});

describe("nowCell", () => {
  it("names the time with its zone instead of falling back to the raw ISO time", async () => {
    const { nowCell } = await import("./bug-layout");
    const cell = nowCell(new Date("2026-11-01T05:04:00Z"), "en-US");
    expect(cell).not.toContain("T05:04");
    expect(cell).toMatch(/Nov 1, 2026/);
  });
});
