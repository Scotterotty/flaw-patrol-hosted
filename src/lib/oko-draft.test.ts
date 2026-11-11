import { describe, expect, it } from "vitest";
import { layoutFromSettings, startAnswers, OKO_EXTRA } from "./bug-layout";
import { parseTemplateSettings } from "./bug-template";
import { draftToOko, okoIntoDraft } from "./oko-draft";

const layout = layoutFromSettings(parseTemplateSettings({ on: true }))!;
const fill = { steps: "", expected: "", actual: "It loops", env: "", hasStep: false, failed: false } as never;
const draft = () => ({
  platform: "WEB",
  area: "Video",
  summary: "Loops",
  answers: startAnswers(layout, fill, { now: "Nov 10", device: "Chrome", build: "4.21.0", env: "QA", who: "Scott" } as never),
  fields: layout.fields.map((f) => ({ ...f, value: [] as string[] })),
});

describe("one OKO form wherever it appears (Nov 10)", () => {
  it("is the OKO layout, with the OKO form's extra Jira fields kept as headings", () => {
    expect(layout.oko).toBe(true);
    expect(layout.sections.map((s) => s.heading)).toEqual(expect.arrayContaining([...OKO_EXTRA, "Repro steps", "Bug impact", "Bug workaround"]));
  });

  it("round-trips everything typed in the OKO form", () => {
    const d = draft();
    const typed = {
      ...draftToOko(d),
      observedOn: "Web",
      clientsNeeded: "Web, Unity",
      reproSteps: "1. Add a video\n2. Play",
      impact: "Everyone watching",
      workaround: "None known",
      spaceLink: "N/a",
      reproRate: "3/5",
      build: "4.21.0",
      team: "Web",
      clients: ["Web"],
      olyEnv: ["o2QA"],
    };
    typed.history = { ...typed.history, csp: "7.1.0", repros: "3/5" };
    const back = draftToOko(okoIntoDraft(d, typed));
    expect(back).toEqual(typed);
    expect(back.what).toBe("It loops");
    expect(back.history.dateTime).toBe("Nov 10");
  });
});
