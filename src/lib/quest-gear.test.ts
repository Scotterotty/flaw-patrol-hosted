import { describe, expect, it } from "vitest";
import { generateQuest, ITEMS } from "./quest";
import { autoSlotFor, fitsOf, parseGear, partyOf, pointsBehind, questRecord, rescueFinds, rescueLine, shownParty, teamwork, troubleLine } from "./quest-gear";

const done = (people: string[], gear: Record<string, object> = {}) =>
  people.map((p, i) => ({ entryId: `e${i}`, at: new Date(i), userId: p, name: p.toUpperCase(), status: "PASSED", gear: gear[p] ?? null }));

/** A seed whose map has trouble on it. */
function troubled(steps = 30) {
  for (let i = 0; i < 500; i++) {
    const m = generateQuest(`t-${i}`, steps);
    if (m.troubles.length) return { seed: `t-${i}`, map: m };
  }
  throw new Error("no trouble found");
}

describe("quest gear", () => {
  it("fits every item somewhere and cleans stored gear", () => {
    for (const i of ITEMS) expect(fitsOf(i.id).length).toBeGreaterThan(0);
    expect(parseGear({ hand: "sword", head: "sword", nope: "duck", companion: "nothing" })).toEqual({ hand: "sword" });
  });

  it("keeps old maps the same and adds troubles only on new ones", () => {
    const old = generateQuest("x", 40, 2);
    expect(old.troubles).toEqual([]);
    const now = generateQuest("x", 40, 3);
    expect(now.path).toEqual(old.path);
    expect(now.events.map((e) => e.step)).toEqual(old.events.map((e) => e.step));
    for (const t of now.troubles) {
      expect(now.events.some((e) => e.step === t.step)).toBe(false);
      expect(t.step).toBeGreaterThan(0);
      expect(t.step).toBeLessThan(40);
      expect(t.thanks.rarity).toBe(t.trouble.rarity);
    }
  });

  it("has the next teammate rescue whoever lands in trouble", () => {
    const { map } = troubled();
    const t = map.troubles[0];
    const people = Array.from({ length: 30 }, (_, i) => (i === t.step - 1 ? "jo" : i === t.step ? "jo" : i === t.step + 1 ? "pri" : "zed"));
    const order = done(people, { pri: { offhand: "coffee" } });
    const ev = teamwork(map, order, 30).find((e) => e.step === t.step)!;
    expect(ev.helper?.userId).toBe("pri");
    expect(ev.self).toBe(false);
    expect(ev.itemId).toBe("coffee");
    expect(troubleLine(ev)).toMatch(/^JO /);
    expect(rescueLine(ev)).toMatch(/^PRI .*JO.* with the Potion of Coffee!$/);
    const finds = rescueFinds([ev], order);
    expect(finds[0].winner.userId).toBe("pri");
    const rec = questRecord("pri", [{ map, done: order, steps: 30 }]);
    expect(rec.rescues).toBeGreaterThanOrEqual(1);
    expect(rec.items.get(t.thanks.id)).toBeGreaterThanOrEqual(1);
  });

  it("lets someone who finishes alone rescue themselves", () => {
    const { map } = troubled();
    const t = map.troubles[map.troubles.length - 1];
    const people = Array.from({ length: 30 }, (_, i) => (i < t.step - 1 ? "zed" : "jo"));
    const ev = teamwork(map, done(people), 30).find((e) => e.step === t.step)!;
    expect(ev.self).toBe(true);
    expect(rescueLine(ev, undefined, undefined, "Release Peak")).toBe("JO rescued themselves and limped into Release Peak!");
    // Not finished yet: still waiting for help.
    expect(teamwork(map, done(people.slice(0, t.step + 1)), 30).find((e) => e.step === t.step)!.helper).toBeNull();
  });

  it("walks the party evenly behind the leader, and always shows you", () => {
    const order = done(["a", "b", "a", "c", "d", "e", "f", "g"]);
    const party = partyOf(order);
    expect(party.map((p) => p.userId)).toEqual(["g", "f", "e", "d", "c", "a", "b"]);
    const { shown, more } = shownParty(party, "b");
    expect(shown).toHaveLength(5);
    expect(shown.map((p) => p.userId)).toContain("b");
    expect(shown[0].userId).toBe("g");
    expect(more).toHaveLength(2);
    const map = generateQuest("walk", 30);
    const pts = pointsBehind(map, 20, 3, 50);
    expect(pts).toHaveLength(3);
    const lead = map.nodes[20];
    expect(Math.hypot(pts[0].x - lead.x, pts[0].y - lead.y)).toBeLessThanOrEqual(50.01);
  });
});

describe("auto-equip", () => {
  it("puts a first find in the first empty slot it fits", () => {
    expect(autoSlotFor("pencil", {}, [])).toBe("hand");
    // A Lantern fits Hand or Off hand: Hand is taken, so Off hand.
    expect(autoSlotFor("lantern", { hand: "pencil" }, [])).toBe("offhand");
    expect(autoSlotFor("cookie", {}, [])).toBe("charm");
  });
  it("never replaces gear, skips slots emptied by hand, and ignores items already worn", () => {
    expect(autoSlotFor("shield", { offhand: "map" }, [])).toBeNull();
    expect(autoSlotFor("pencil", {}, ["hand"])).toBeNull();
    expect(autoSlotFor("lantern", {}, ["hand"])).toBe("offhand");
    expect(autoSlotFor("pencil", { hand: "pencil" }, [])).toBeNull();
  });
});
