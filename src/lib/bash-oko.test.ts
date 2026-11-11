import { describe, expect, it } from "vitest";
import { askFinderNote, askIds, firstName, isAskOf, notABugLine, OKO_FORM, okoFilled, okoNeeds, okoStart, withOko } from "./bash-oko";
import { layoutFromSettings } from "./bug-layout";
import { findTemplate, needsOf } from "./bash-template";
import { TEMPLATE_OFF } from "./bug-template";

const layout = layoutFromSettings({ ...TEMPLATE_OFF, on: true })!;
const auto = { now: "", build: "", env: "", device: "", who: "" };
const oko = { layout, defaults: { team: "Web", clients: [] } };

describe("bug bash bugs with the OKO layout (ver_220)", () => {
  it("is the OKO layout, with the three Add for Jira boxes", () => {
    expect(layout.oko).toBe(true);
    const ids = askIds(layout);
    expect(Object.values(ids).every(Boolean)).toBe(true);
  });

  it("fills in Team, Build #, Repro rate and the one line; asks for the rest", () => {
    const t = okoStart(layout, oko.defaults, { values: {}, actual: "Repeat won't turn off", build: "4.21.0", env: "", auto });
    expect(t.layout.fields.find((f) => f.name === "Team")?.value).toEqual(["Web"]);
    expect(t.answers.find((a) => a.heading === "Build #")?.text).toBe("4.21.0");
    expect(t.answers.find((a) => a.heading === "Repro rate")?.text).toBe("1/1");
    expect(t.answers.find((a) => a.heading === "Description")?.text).toBe("Repeat won't turn off");
    // Client/SKUs follows the bug's client: needed only when there's none.
    expect(okoNeeds(t.layout, t.answers, "Web").words).toEqual(["Repro steps", "Bug impact", "Workaround"]);
    expect(okoNeeds(t.layout, t.answers, "").words).toContain("Client/SKUs");
    expect(okoFilled(t.layout, t.answers, "Web")).toEqual([
      { name: "Team", value: "Web" },
      { name: "Client/SKUs", value: "Web" },
      { name: "Build #", value: "4.21.0" },
      { name: "OKO Space Link", value: "N/a" },
    ]);
  });

  it("is Ready once the boxes are filled in, logged or added later", () => {
    const ids = askIds(layout);
    const values = { [ids["Repro steps"]]: { text: "1. Add a video", files: [] }, [ids["Bug impact"]]: { text: "Annoying", files: [] }, [ids["Bug workaround"]]: { text: "None known", files: [] } };
    const t = okoStart(layout, oko.defaults, { values, actual: "x", build: "1", env: "", auto });
    expect(needsOf(t.layout, t.answers, [], "Web").words).toEqual([]);
    // No team default and no build: those are needed too.
    const bare = okoStart(layout, { team: "", clients: [] }, { values, actual: "x", build: "", env: "", auto });
    expect(okoNeeds(bare.layout, bare.answers, "Web").words).toEqual(["Team", "Build #"]);
  });

  it("sees a plain bash bug in an OKO cycle with the OKO layout, steps as Repro steps", () => {
    const plain = { kind: "bug", text: "Stops at the start", details: "1. Play\n2. Stop", build: "4.21.0", templateName: "", layout: null, answers: null, defectId: null, platform: "Web" };
    const seen = withOko(plain, oko);
    expect(seen.templateName).toBe(OKO_FORM);
    const t = findTemplate(seen, []);
    expect(t?.needs).toEqual(["Bug impact", "Workaround"]);
    // Filed bugs, other finds and cycles without OKO stay as they are.
    expect(withOko({ ...plain, defectId: "d1" }, oko).templateName).toBe("");
    expect(withOko({ ...plain, kind: "note" }, oko).templateName).toBe("");
    expect(withOko(plain, null).templateName).toBe("");
  });

  it("says Not a bug with its reason, and asks the finder by first name", () => {
    expect(notABugLine("Works as designed")).toBe("Not a bug · Works as designed");
    expect(notABugLine("")).toBe("Not a bug");
    expect(firstName("Sam Lee")).toBe("Sam");
    expect(firstName("sam@example.com")).toBe("sam");
    const note = askFinderNote("Sam Lee");
    expect(note).toBe("@Sam, we couldn't reproduce this. Can you add steps?");
    expect(isAskOf(note, "Sam Lee")).toBe(true);
    expect(isAskOf("Looks fine", "Sam Lee")).toBe(false);
  });
});
