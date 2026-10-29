import { describe, expect, it } from "vitest";
import { badgeOf, levelFor, streaks, totalXp, unlockDetail, xpForLevel } from "./game";

describe("levels", () => {
  it("start at 1 and grow", () => {
    expect(xpForLevel(2)).toBe(100);
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(1000)).toEqual({ level: 5, from: 1000, to: 1500 });
  });
  it("add up XP by rule", () => {
    expect(
      totalXp({
        verdict: 10,
        runCompleted: 1,
        bugFiled: 2,
        bugFixed: 1,
        sessionBug: 4,
        regression: 1,
        caseRunByOthers: 1,
        caseCreated: 2,
        caseImproved: 1,
        sharedStepUsed: 1,
        suiteRun: 1,
        streakDay: 1,
      }),
    ).toBe(50 + 25 + 20 + 40 + 12 + 15 + 20 + 20 + 3 + 10 + 15 + 10);
  });
});

describe("streaks", () => {
  it("carry over weekends", () => {
    // Thu, Fri, Mon, then a gap, then Wed.
    const s = streaks(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-07"]);
    expect(s.best).toBe(3);
    expect(s.continued).toBe(2);
  });
});

describe("badges", () => {
  it("only show for players", () => {
    expect(badgeOf({ gameEnabled: false, gameTitle: "master", gameFrame: "gold" })).toEqual({ title: null, frame: null });
    expect(badgeOf({ gameEnabled: true, gameTitle: "master", gameFrame: "gold" })).toEqual({ title: "Test Master", frame: "gold" });
    expect(badgeOf({ gameEnabled: true, gameTitle: "nope", gameFrame: "nope" })).toEqual({ title: null, frame: null });
  });
});

describe("unlock details", () => {
  const stats = {
    verdict: 0,
    runCompleted: 0,
    bugFiled: 26,
    bugFixed: 2,
    sessionBug: 0,
    regression: 0,
    caseRunByOthers: 14,
    caseCreated: 18,
    caseImproved: 0,
    sharedStepUsed: 0,
    suiteRun: 0,
    streakDay: 0,
    bestStreak: 3,
    currentStreak: 0,
    earlyAdopter: 0,
    rescues: 0,
  };
  it("say how a work title was earned, with the count", () => {
    const d = unlockDetail({ stat: "caseRunByOthers", atLeast: 10 }, stats, 4, 720);
    expect(d).toMatchObject({ kind: "work", unlocked: true, have: 14, need: 10 });
    expect(d.how).toBe("14 of your cases were run by teammates (needed 10)");
  });
  it("give the rule and progress when locked", () => {
    expect(unlockDetail({ stat: "caseCreated", atLeast: 25 }, stats, 4, 720)).toMatchObject({ unlocked: false, how: "Write 25 test cases", have: 18, need: 25 });
    expect(unlockDetail({ level: 5 }, stats, 4, 720)).toMatchObject({ kind: "xp", unlocked: false, how: "Reach level 5 (1,000 XP)", have: 720, need: 1000 });
    expect(unlockDetail({ level: 3 }, stats, 4, 720).how).toBe("Reached level 3 (300 XP)");
  });
  it("count filed bugs for Bug Writer", () => {
    expect(unlockDetail({ stat: "bugFiled", atLeast: 25 }, stats, 4, 720)).toMatchObject({ unlocked: true, how: "You filed 26 bugs (needed 25)" });
  });
});
