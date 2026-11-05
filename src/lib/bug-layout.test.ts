import { describe, expect, it } from "vitest";
import { acceptOf, answersText, autoRow, blankLayout, deviceCell, fileAllowed, isWritten, layoutFromImported, layoutFromSettings, layoutTitle, listWords, missing, parseAnswers, parseLayout, plainLayout, readyMadeLayout, startAnswers, withFileNames, type BugLayout } from "./bug-layout";
import { answersAdf } from "./jira-format";

const auto = { now: "Oct 31, 2026, 6:14 PM PDT", build: "4.2.0-118", env: "Staging", device: "Chrome 141 · Windows", who: "Sam Lee" };
const fill = { steps: "1. Open Checkout\n2. Tap Pay", expected: "The payment screen opens.", actual: "The app closed.", env: "Build: 4.2.0-118", hasStep: true, failed: true };

const crash: BugLayout = parseLayout({
  title: { platform: true, area: true, build: false },
  sections: [
    { id: "a", heading: "Steps to reproduce", source: "steps" },
    { id: "b", heading: "Expected", source: "expected" },
    { id: "c", heading: "What happened", source: "actual" },
    { id: "d", heading: "Crash log", source: "file", must: true, types: ".txt, .log", paste: true },
    { id: "e", heading: "How often", source: "choice", choices: ["Every time", "Sometimes"] },
    { id: "f", heading: "Reproduction history", source: "table", growing: true, columns: [{ name: "Date & time", fill: "now" }, { name: "Repros", fill: "write" }, { name: "Attachments", fill: "files" }] },
    { id: "g", heading: "Notes", source: "empty" },
  ],
});

describe("bug layouts", () => {
  it("reads a saved layout and drops junk", () => {
    const l = parseLayout({ sections: [{ heading: "" }, { id: "x", heading: "Hi", source: "nope", must: true }, { id: "x", heading: "Again", source: "table" }], title: { build: true } });
    expect(l.sections.map((s) => [s.id, s.source])).toEqual([["x", "text"], ["xx", "table"]]);
    expect(l.sections[0].must).toBe(true);
    expect(l.sections[1].columns.length).toBe(8);
    expect(l.title).toEqual({ platform: true, area: true, build: true });
    expect(parseLayout(null).sections).toEqual([]);
  });

  it("only lets fill-in headings be required", () => {
    expect(parseLayout({ sections: [{ heading: "Env", source: "env", must: true }] }).sections[0].must).toBe(false);
  });

  it("makes titles from the parts that are on", () => {
    expect(layoutTitle({ platform: true, area: true, build: false }, { platform: "[Windows]", area: "Checkout", build: "1.2", summary: "App closes" })).toBe("[Windows] - Checkout - App closes");
    expect(layoutTitle({ platform: true, area: false, build: true }, { platform: "", area: "Checkout", build: "1.2", summary: "App closes" })).toBe("1.2 - App closes");
  });

  it("starts a bug from the run, leaving out Leave out headings", () => {
    const a = startAnswers(crash, fill, auto);
    expect(a.map((x) => x.heading)).toEqual(["Steps to reproduce", "Expected", "What happened", "Crash log", "How often", "Reproduction history"]);
    expect(a[0].text).toContain("Tap Pay");
    expect(a[5].rows).toEqual([["Oct 31, 2026, 6:14 PM PDT", "", ""]]);
    expect(autoRow(crash.sections[5].columns, auto)).toEqual(["Oct 31, 2026, 6:14 PM PDT", "", ""]);
  });

  it("turns step headings into text boxes when there is no test step", () => {
    const a = startAnswers(crash, { ...fill, hasStep: false, failed: false }, auto);
    expect(a[0]).toMatchObject({ source: "text", text: "" });
    expect(a[1]).toMatchObject({ source: "text", text: "" });
    expect(a[2].text).toBe("The app closed.");
  });

  it("says what's missing before reporting", () => {
    const a = startAnswers(crash, fill, auto);
    expect(missing(crash, a, 0)).toEqual(["Crash log"]);
    const pasted = a.map((x) => (x.id === "d" ? { ...x, text: "NullReference" } : x));
    expect(missing(crash, pasted, 0)).toEqual([]);
    const withFile = a.map((x) => (x.id === "d" ? { ...x, files: [{ id: "f1", fileName: "crash.txt" }] } : x));
    expect(missing({ ...crash, shot: true }, withFile, 0)).toEqual(["a screenshot or video"]);
    expect(listWords(["Crash log", "a screenshot or video"])).toBe("Crash log and a screenshot or video");
  });

  it("checks file endings", () => {
    expect(fileAllowed(".txt, .log", "crash.TXT")).toBe(true);
    expect(fileAllowed(".txt, .log", "crash.png")).toBe(false);
    expect(fileAllowed("", "anything.bin")).toBe(true);
    expect(fileAllowed("txt", "a.txt")).toBe(true);
    expect(acceptOf(".txt, log")).toBe(".txt,.log");
  });

  it("names the bug's files in a table's files column", () => {
    const a = startAnswers(crash, fill, auto)[5];
    expect(withFileNames(a, ["pay.png", "crash.txt"]).rows).toEqual([["Oct 31, 2026, 6:14 PM PDT", "", "pay.png\ncrash.txt"]]);
    expect(withFileNames(a, []).rows![0][2]).toBe("None");
  });

  it("writes the bug as text and as a Jira body", () => {
    const a = startAnswers(crash, fill, auto).map((x) => (x.id === "e" ? { ...x, text: "Every time" } : x.id === "d" ? { ...x, files: [{ id: "f1", fileName: "crash.txt" }] } : x));
    const t = answersText(a);
    expect(t).toContain("How often\nEvery time");
    expect(t).toContain("Crash log\nFiles: crash.txt");
    expect(t).toContain("Reproduction history\nDate & time: Oct 31, 2026, 6:14 PM PDT | Repros: - | Attachments: -");
    const doc = answersAdf(a, { trace: { label: "APP-1", link: null }, fileUrl: (id) => `https://x/${id}` }) as { content: { type: string }[] };
    const types = doc.content.map((n) => n.type);
    expect(types).toContain("table");
    expect(types).toContain("bulletList");
    expect(JSON.stringify(doc)).toContain("https://x/f1");
  });

  it("reads saved answers safely", () => {
    const a = parseAnswers([{ id: "f", heading: "Table", source: "table", text: "", columns: [{ name: "A", fill: "write" }], rows: [["x", 3]] }, { heading: "no id" }, null]);
    expect(a).toEqual([{ id: "f", heading: "Table", source: "table", text: "", columns: [{ name: "A", fill: "write" }], rows: [["x", ""]], growing: false }]);
  });

  it("copies a layout from Jira and the ready-made one", () => {
    const l = layoutFromImported({ from: "QA-418", title: { tag: true, feature: false }, sections: [{ heading: "Steps", source: "steps" }, { heading: "Notes", source: "tester" }], fields: [] });
    expect(l.sections.map((s) => s.source)).toEqual(["steps", "text"]);
    expect(l.title).toEqual({ platform: true, area: false, build: false });
    expect(readyMadeLayout().sections.some((s) => s.source === "table" && s.growing)).toBe(true);
    expect(blankLayout().sections.length).toBe(4);
  });

  it("names browsers and systems", () => {
    expect(deviceCell("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe("Chrome 141 · Windows");
    expect(deviceCell("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari 18 · iOS");
  });

  it("Write a bug: Plain is three boxes to write in, and a run's headings become boxes too", () => {
    const plain = plainLayout();
    expect(plain.sections.map((x) => [x.heading, x.source])).toEqual([
      ["Steps to reproduce", "text"],
      ["What happened", "text"],
      ["What you expected", "text"],
    ]);
    // Nothing a run would fill: no case, no step.
    const none = { steps: "", expected: "", actual: "", env: "", hasStep: false, failed: false };
    const auto = { now: "", build: "", env: "", device: "", who: "Ann" };
    expect(startAnswers(plain, none, auto).every((a) => a.source === "text" && a.text === "")).toBe(true);
    const fromRun = startAnswers(blankLayout(), none, auto);
    expect(fromRun.find((a) => a.heading === "Steps to reproduce")?.source).toBe("text");
    expect(fromRun.find((a) => a.heading === "Expected")?.source).toBe("text");
    // Only Summary is required with Plain.
    expect(missing(plain, startAnswers(plain, none, auto), 0)).toEqual([]);
  });

  it("knows a written bug by its saved layout", () => {
    expect(isWritten({ ...plainLayout(), written: true })).toBe(true);
    expect(isWritten(plainLayout())).toBe(false);
    expect(isWritten(null)).toBe(false);
    // Reading the layout back drops the mark, so it never reaches the form.
    expect("written" in parseLayout({ ...plainLayout(), written: true })).toBe(false);
  });
});

describe("layoutFromSettings (Write a bug's first choice)", () => {
  const base = { on: false, clientTag: "", team: "", clients: [], olyEnv: [], imported: null, priority: null };
  it("is nothing for the plain layout", () => {
    expect(layoutFromSettings(base)).toBeNull();
  });
  it("turns the OKO layout into its headings, with Team and Client/SKUs to pick and no presets", () => {
    const l = layoutFromSettings({ ...base, on: true, team: "Web", clients: ["Web"] })!;
    expect(l.sections.map((s) => s.heading)).toContain("Bug impact");
    expect(l.fields.find((f) => f.name === "Team")).toMatchObject({ source: "tester", value: [] });
    expect(l.fields.find((f) => f.name === "Client/SKUs")).toMatchObject({ source: "tester", value: [] });
  });
  it("gives the same section ids every time, so typed answers line up", () => {
    const t = { ...base, on: true };
    expect(layoutFromSettings(t)!.sections.map((s) => s.id)).toEqual(layoutFromSettings(t)!.sections.map((s) => s.id));
  });
  it("uses a copied Jira bug's layout as it is", () => {
    const imported = { from: "QA-1", title: { tag: true, feature: false }, sections: [{ heading: "Steps", source: "steps" as const }], fields: [] };
    expect(layoutFromSettings({ ...base, on: true, imported })?.from).toBe("QA-1");
  });
});
