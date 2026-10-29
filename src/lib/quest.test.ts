import { describe, expect, it } from "vitest";
import { FOES, foundRewards, generateQuest, ITEMS, MAP_H, MAP_W, questRewards, RARITIES, rarityOdds, satchels, seeded } from "./quest";

describe("quest maps", () => {
  it("are the same for the same run and differ between runs", () => {
    expect(generateQuest("run-a", 12)).toEqual(generateQuest("run-a", 12));
    expect(generateQuest("run-a", 12).path).not.toEqual(generateQuest("run-b", 12).path);
    const r = seeded("x");
    expect(r()).not.toEqual(r());
  });

  it("have a node per step inside the map, with events between start and end", () => {
    for (const steps of [1, 2, 7, 40, 300]) {
      const q = generateQuest(`seed-${steps}`, steps);
      expect(q.nodes).toHaveLength(steps + 1);
      for (const n of q.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x).toBeLessThanOrEqual(MAP_W);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeLessThanOrEqual(MAP_H);
      }
      const at = q.events.map((e) => e.step);
      expect(new Set(at).size).toBe(at.length);
      for (const s of at) {
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThan(Math.max(2, steps));
      }
      expect(q.events.length).toBeLessThanOrEqual(12);
    }
    // Every road has at least one find, even a one-step one.
    for (const steps of [1, 2, 3]) expect(generateQuest(`tiny-${steps}`, steps).events.length).toBeGreaterThanOrEqual(1);
    expect(generateQuest("one", 1).events[0].step).toBe(1);
  });

  it("give each event to whoever moved the pawn onto it", () => {
    const q = generateQuest("rewards", 8);
    const done = Array.from({ length: 8 }, (_, i) => ({ entryId: `e${i}`, at: new Date(i), userId: `u${i}`, name: `P${i}`, status: "PASSED" }));
    for (const r of questRewards(q, done)) expect(r.winner?.userId).toBe(`u${r.step - 1}`);
    for (const r of questRewards(q, done.slice(0, 1))) expect(r.winner === null || r.step === 1).toBe(true);
  });

  it("keep unfound rewards hidden and fill each tester's satchel", () => {
    const q = generateQuest("hidden", 20);
    const person = (i: number) => (i % 2 ? { userId: "ann", name: "Ann" } : { userId: "bo", name: "Bo" });
    const done = Array.from({ length: 10 }, (_, i) => ({ entryId: `e${i}`, at: new Date(i), ...person(i), status: "PASSED", caseNumber: i + 1 }));
    const found = foundRewards(q, done);
    expect(found.every((r) => r.step <= 10)).toBe(true);
    expect(found).toHaveLength(q.events.filter((e) => e.step <= 10).length);
    const bags = satchels([{ run: { number: 7 }, rewards: found, order: done }]);
    expect(bags.map((b) => b.name)).toEqual([...new Set(found.map((r) => r.winner.name))].sort());
    for (const b of bags) for (const f of b.finds) expect([f.runNumber, f.caseNumber, person(f.step - 1).name]).toEqual([7, f.step, b.name]);
    expect(foundRewards(q, [])).toEqual([]);
    // Emptying Ann's satchel after step 5 keeps only what she found later.
    const emptied = satchels([{ run: { number: 7 }, rewards: found, order: done }], new Map([["ann", new Date(5)]]));
    for (const f of emptied.find((b) => b.userId === "ann")?.finds ?? []) expect(f.winner.at.getTime()).toBeGreaterThanOrEqual(5);
    expect(emptied.find((b) => b.userId === "bo")?.finds.length).toBe(bags.find((b) => b.userId === "bo")?.finds.length);
  });

  it("make rare finds likelier on longer runs", () => {
    for (const r of RARITIES) {
      expect(ITEMS.some((i) => i.rarity === r)).toBe(true);
      expect(FOES.some((f) => f.rarity === r)).toBe(true);
    }
    for (const steps of [1, 5, 20, 50, 400]) {
      const odds = rarityOdds(steps);
      expect(Object.values(odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
    expect(rarityOdds(5).exotic).toBeLessThan(rarityOdds(20).exotic / 5);
    expect(rarityOdds(50).exotic).toBeGreaterThan(0.005);
    expect(rarityOdds(400)).toEqual(rarityOdds(50));
    // Over many runs, big ones turn up exotics and small ones essentially never do.
    const exotics = (steps: number) =>
      Array.from({ length: 400 }, (_, i) => generateQuest(`luck-${steps}-${i}`, steps).events.filter((e) => e.rarity === "exotic").length).reduce((a, b) => a + b, 0);
    expect(exotics(60)).toBeGreaterThan(exotics(4));
  });

  it("keep each run on the catalog it started with", () => {
    const newIds = new Set([...ITEMS, ...FOES].filter((f) => f.since === 2).map((f) => f.id));
    expect(newIds.size).toBeGreaterThan(0);
    for (const kind of [ITEMS, FOES]) {
      expect(new Set(kind.map((f) => f.id)).size).toBe(kind.length);
      for (const r of RARITIES) expect(kind.some((f) => f.rarity === r && !f.since)).toBe(true);
    }
    let sawNew = false;
    for (let i = 0; i < 300; i++) {
      const old = generateQuest(`cat-${i}`, 40, 1).events;
      expect(old.some((e) => newIds.has(e.id))).toBe(false);
      if (generateQuest(`cat-${i}`, 40).events.some((e) => newIds.has(e.id))) sawNew = true;
    }
    expect(sawNew).toBe(true);
  });
});
