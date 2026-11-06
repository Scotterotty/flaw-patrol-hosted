import { describe, expect, it } from "vitest";
import { foundRewards, generateQuest, questName, walkOrder, type Completion } from "./quest";
import { questRecord, teamwork } from "./quest-gear";

/** A seed whose map has trouble on it. */
function troubled(steps = 30) {
  for (let i = 0; i < 500; i++) {
    const m = generateQuest(`t-${i}`, steps);
    if (m.troubles.length) return m;
  }
  throw new Error("no trouble found");
}

const c = (i: number, userId: string, imported = false): Completion => ({ entryId: `e${i}`, at: new Date(i * 1000), userId, name: userId, status: "PASSED", imported });

describe("quest maps and imported results (ver_183)", () => {
  it("walks results saved here first, then imported ones", () => {
    const list = [c(1, "a"), c(2, "ryan", true), c(3, "b"), c(0, "ryan", true)];
    expect(walkOrder(list).map((x) => x.entryId)).toEqual(["e1", "e3", "e0", "e2"]);
  });

  it("imported results move the pawn but never take finds", () => {
    const map = generateQuest("import-run", 20);
    const all = Array.from({ length: 20 }, (_, i) => c(i, "ryan", true));
    expect(foundRewards(map, all)).toEqual([]);
    const live = Array.from({ length: 20 }, (_, i) => c(i, "jo"));
    expect(foundRewards(map, live).length).toBe(map.events.length);
    expect(questRecord("ryan", [{ map, done: all, steps: 20 }]).items.size).toBe(0);
  });

  it("imported results never fall into trouble or rescue anyone", () => {
    const map = troubled();
    const t = map.troubles[0];
    // An imported result lands on the trouble: nothing happens.
    const imp = Array.from({ length: 30 }, (_, i) => c(i, i === t.step - 1 ? "ryan" : "jo", i === t.step - 1));
    expect(teamwork(map, imp, 30).find((e) => e.step === t.step)).toBeUndefined();
    // Someone saved here lands on it; an imported result after doesn't count as the rescue.
    const live = Array.from({ length: t.step + 1 }, (_, i) => (i === t.step ? c(i, "ryan", true) : c(i, "jo")));
    const ev = teamwork(map, live, 30).find((e) => e.step === t.step);
    expect(ev?.victim.userId).toBe("jo");
    expect(ev?.helper).toBeNull();
  });

  it("shows a name made from the email when someone has no name", () => {
    expect(questName("ryan.meredith@magnopus.com")).toBe("Ryan Meredith");
    expect(questName("jordan_matthews@x.co")).toBe("Jordan Matthews");
    expect(questName("Scott Smith")).toBe("Scott Smith");
    expect(questName("Someone")).toBe("Someone");
  });
});
