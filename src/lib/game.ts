// The opt-in mini game. XP rewards useful work rather than raw counts, so
// filing duplicate bugs or clicking through steps doesn't pay. Everything is
// worked out from the work itself (see src/lib/xp.ts), so it counts past
// work too and can't drift out of step with it.

import { funOff } from "./fun";

export const XP_RULES = {
  verdict: {
    xp: 5,
    label: "Cases run",
    hint: "each case you give a verdict in a run",
  },
  runCompleted: {
    xp: 25,
    label: "Runs completed",
    hint: "each completed run you tested in",
  },
  bugFiled: {
    xp: 10,
    label: "Bugs filed",
    hint: "each new bug you filed from a run (not Won't fix)",
  },
  bugFixed: {
    xp: 40,
    label: "Bugs fixed",
    hint: "each bug you filed that Jira shows done or a teammate marked fixed",
  },
  sessionBug: {
    xp: 3,
    label: "Session bugs logged",
    hint: "each bug you logged in an exploratory session, up to 10 per session",
  },
  regression: {
    xp: 15,
    label: "Regressions caught",
    hint: "each failure you found in a case that passed before",
  },
  caseRunByOthers: {
    xp: 20,
    label: "Cases others ran",
    hint: "each new case you wrote that a teammate has run",
  },
  caseCreated: {
    xp: 10,
    label: "Cases written",
    hint: "each new test case you wrote by hand that has steps and isn't archived",
  },
  caseImproved: {
    xp: 3,
    label: "Cases improved",
    hint: "each case you updated, counted once per case per day",
  },
  sharedStepUsed: {
    xp: 10,
    label: "Shared steps in use",
    hint: "each new shared step you created that a case uses",
  },
  suiteRun: {
    xp: 15,
    label: "Suites run",
    hint: "each new suite you built that has been run",
  },
  streakDay: {
    xp: 10,
    label: "Streak days",
    hint: "each working day you tested, following one you also tested",
  },
  // Glossary: explaining the team's words. Editing and asking earn nothing.
  glossaryTerm: {
    xp: 5,
    label: "Glossary terms added",
    hint: "each term you added with a meaning of at least 3 words",
  },
  glossaryAnswer: {
    xp: 10,
    label: "Questions answered",
    hint: "each teammate's Glossary question you answered",
  },
  glossaryHelp: {
    xp: 1,
    label: "Terms that helped",
    hint: "each teammate who opened the meaning of a term you wrote, up to 10 per term",
  },
} as const;

export type XpRule = keyof typeof XP_RULES;
/** Most bugs per exploratory session that earn XP. */
export const SESSION_BUG_CAP = 10;
export type XpCounts = Record<XpRule, number>;
export type GameStats = XpCounts & {
  bestStreak: number;
  currentStreak: number;
  /** 1 for people who signed in before launch, else 0. */
  earlyAdopter: number;
  /** Teammates rescued on quest maps. No XP; it unlocks Field Medic. */
  rescues: number;
  /** Teammates who opened the meaning of a term you wrote, with no cap. No XP; it unlocks Bookworm. */
  glossaryLookups: number;
};

export function totalXp(c: XpCounts) {
  return (Object.keys(XP_RULES) as XpRule[]).reduce((sum, k) => sum + c[k] * XP_RULES[k].xp, 0);
}

/** XP needed to reach a level: 0, 100, 300, 600, 1000, ... */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

export function levelFor(xp: number) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return { level, from: xpForLevel(level), to: xpForLevel(level + 1) };
}

type Unlock = { level?: number; stat?: keyof GameStats; atLeast?: number };

export const unlockText = (u: Unlock) =>
  u.level
    ? `Reach level ${u.level}`
    : u.stat === "earlyAdopter"
      ? "Sign in to Flaw Patrol before it goes live"
      : u.stat === "bestStreak"
        ? `Test ${u.atLeast} working days in a row`
        : u.stat === "rescues"
          ? `Rescue ${u.atLeast} teammates on quest maps`
        : u.stat === "glossaryLookups"
          ? `Have your Glossary terms looked up ${u.atLeast} times`
        : `${u.atLeast} ${XP_RULES[u.stat as XpRule].label.toLowerCase()}`;

export const TITLES = [
  { id: "rookie", label: "Rookie Tester", unlock: { level: 1 } },
  { id: "early", label: "Early Adopter", unlock: { stat: "earlyAdopter", atLeast: 1 } },
  { id: "spotter", label: "Bug Spotter", unlock: { level: 2 } },
  { id: "runner", label: "Step Runner", unlock: { level: 3 } },
  { id: "master", label: "Test Master", unlock: { level: 5 } },
  { id: "slayer", label: "Regression Slayer", unlock: { level: 7 } },
  { id: "guardian", label: "Quality Guardian", unlock: { level: 10 } },
  {
    id: "hunter",
    label: "Bug Hunter",
    unlock: { stat: "bugFixed", atLeast: 5 },
  },
  {
    id: "catcher",
    label: "Regression Catcher",
    unlock: { stat: "regression", atLeast: 3 },
  },
  {
    id: "crafter",
    label: "Bestselling Author",
    unlock: { stat: "caseRunByOthers", atLeast: 10 },
  },
  { id: "writer", label: "Case Writer", unlock: { stat: "caseCreated", atLeast: 25 } },
  { id: "bugwriter", label: "Bug Writer", unlock: { stat: "bugFiled", atLeast: 25 } },
  {
    id: "steady",
    label: "Streak Keeper",
    unlock: { stat: "bestStreak", atLeast: 5 },
  },
  { id: "medic", label: "Field Medic", unlock: { stat: "rescues", atLeast: 3 } },
  { id: "wordfinder", label: "Word Finder", unlock: { stat: "glossaryTerm", atLeast: 10 } },
  { id: "translator", label: "Team Translator", unlock: { stat: "glossaryAnswer", atLeast: 10 } },
  { id: "dictionary", label: "Walking Dictionary", unlock: { stat: "glossaryTerm", atLeast: 40 } },
] as const satisfies readonly { id: string; label: string; unlock: Unlock }[];

export const FRAMES = [
  { id: "bronze", label: "Bronze", unlock: { level: 2 } },
  { id: "silver", label: "Silver", unlock: { level: 4 } },
  { id: "gold", label: "Gold", unlock: { level: 6 } },
  { id: "holo", label: "Holo", unlock: { level: 8 } },
  { id: "ink", label: "Octopus ink", unlock: { level: 10 } },
  { id: "bug", label: "Bug hunter", unlock: { stat: "bugFixed", atLeast: 10 } },
  { id: "fresh", label: "Early Adopter Shine", unlock: { stat: "earlyAdopter", atLeast: 1 } },
  { id: "bookworm", label: "Bookworm", unlock: { stat: "glossaryLookups", atLeast: 100 } },
] as const satisfies readonly { id: string; label: string; unlock: Unlock }[];

export type TitleId = (typeof TITLES)[number]["id"];
export type FrameId = (typeof FRAMES)[number]["id"];

export function isUnlocked(u: Unlock, stats: GameStats, level: number) {
  if (u.level) return level >= u.level;
  return stats[u.stat!] >= u.atLeast!;
}

/** A title's words; a crown ("crown|group|key|label|umbrella") reads "👑 Ruler of the Web". */
export const titleLabel = (id: string | null | undefined) => (id?.startsWith("crown|") ? `👑 ${id.split("|")[3] ?? "Crown"}` : (TITLES.find((t) => t.id === id)?.label ?? null));
export const isFrame = (id: string | null | undefined): id is FrameId => FRAMES.some((f) => f.id === id);

/** What others see next to someone's name: only when they play and picked one. */
export function badgeOf(u: { gameEnabled?: boolean | null; gameTitle?: string | null; gameFrame?: string | null }) {
  if (!u.gameEnabled || funOff()) return { title: null, frame: null };
  return {
    title: titleLabel(u.gameTitle),
    frame: isFrame(u.gameFrame) ? u.gameFrame : null,
  };
}

/** Working days in a row: Friday then Monday still counts. Days are "YYYY-MM-DD". */
export function streaks(days: string[]) {
  const set = new Set(days);
  const sorted = [...set].sort();
  const prevWorkday = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    do t.setUTCDate(t.getUTCDate() - 1);
    while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
    return t.toISOString().slice(0, 10);
  };
  let continued = 0;
  let best = 0;
  let run = 0;
  for (const d of sorted) {
    if (set.has(prevWorkday(d))) {
      continued++;
      run++;
    } else run = 1;
    best = Math.max(best, run);
  }
  // The current streak is alive if the last tested day is today or the previous working day.
  const today = new Date().toISOString().slice(0, 10);
  const last = sorted[sorted.length - 1];
  const alive = last === today || last === prevWorkday(today);
  return { continued, best, current: alive ? run : 0 };
}

/** What exactly counts toward each unlock that isn't an XP level, in plain words. */
const WHAT_COUNTS: Partial<Record<keyof GameStats, { rule: (n: number) => string; earned: (have: number, need: number) => string; counts: string[] }>> = {
  caseRunByOthers: {
    rule: (n) => `${n} cases you wrote, run by a teammate`,
    earned: (h, n) => `${h} of your cases were run by teammates (needed ${n})`,
    counts: [
      "Each case you wrote counts once, the first time someone else gives it a result in a run.",
      "Only cases written since October 24, 2026 count. Imported cases and your own runs of your cases don't count.",
    ],
  },
  caseCreated: {
    rule: (n) => `Write ${n} test cases`,
    earned: (h, n) => `You wrote ${h} test cases (needed ${n})`,
    counts: ["Cases you wrote by hand that have steps and aren't archived.", "Only cases written since October 24, 2026 count. Imported cases don't count."],
  },
  bugFiled: {
    rule: (n) => `File ${n} bugs`,
    earned: (h, n) => `You filed ${h} bugs (needed ${n})`,
    counts: ["New bugs you filed from a step or case in a run, in Jira or in Flaw Patrol.", "Linking an issue that was already in Jira, bugs from an imported sheet and bugs marked Won't fix don't count."],
  },
  regression: {
    rule: (n) => `Catch ${n} regressions`,
    earned: (h, n) => `You caught ${h} regressions (needed ${n})`,
    counts: ["A failure you found in a case that passed in an earlier run."],
  },
  bugFixed: {
    rule: (n) => `Have ${n} bugs you filed get fixed`,
    earned: (h, n) => `${h} bugs you filed were fixed (needed ${n})`,
    counts: [
      "Bugs you filed from Flaw Patrol that Jira shows as done, or that a teammate marked Fixed or Closed.",
      "Marking your own bug fixed, linked Jira issues and bugs marked Won't fix don't count.",
    ],
  },
  bestStreak: {
    rule: (n) => `Test ${n} working days in a row`,
    earned: (h, n) => `Best streak ${h} working days (needed ${n})`,
    counts: ["Days you gave a result in any run. Weekends don't break a streak."],
  },
  rescues: {
    rule: (n) => `Rescue ${n} teammates on quest maps`,
    earned: (h, n) => `You rescued ${h} teammates (needed ${n})`,
    counts: ["On a quest map, a teammate who lands on trouble is stuck until someone else saves the next case in that run. That's a rescue.", "Rescuing yourself doesn't count."],
  },
  glossaryTerm: {
    rule: (n) => `Add ${n} Glossary terms`,
    earned: (h, n) => `You added ${h} Glossary terms (needed ${n})`,
    counts: ["Terms you added to the Glossary with a meaning of at least 3 words.", "Asking the team, editing and terms that were deleted don't count."],
  },
  glossaryAnswer: {
    rule: (n) => `Answer ${n} teammates' Glossary questions`,
    earned: (h, n) => `You answered ${h} Glossary questions (needed ${n})`,
    counts: ["Questions a teammate asked under Needs an answer that you gave a meaning of at least 3 words.", "Answering your own question counts as adding a term instead."],
  },
  glossaryLookups: {
    rule: (n) => `Have your Glossary terms looked up ${n} times`,
    earned: (h, n) => `Teammates looked up your terms ${h} times (needed ${n})`,
    counts: ["Each teammate who opens the meaning of a term you wrote counts once per term.", "Looking up your own terms doesn't count."],
  },
  earlyAdopter: {
    rule: () => "Sign in to Flaw Patrol before it goes live",
    earned: () => "You signed in before Flaw Patrol went live",
    counts: ["Everyone who signed in before launch keeps this for good."],
  },
};

export type UnlockDetail = {
  /** "xp" unlocks come from levels, "work" ones from reaching a count. */
  kind: "xp" | "work";
  unlocked: boolean;
  /** The rule met (when unlocked, with your count) or the rule to meet. */
  how: string;
  have: number;
  need: number;
  /** For the detail box: exactly what counts. */
  counts: string[];
};

/** How an unlock was earned, or how close you are, for the titles and frames pickers. */
export function unlockDetail(u: Unlock, stats: GameStats, level: number, xp: number): UnlockDetail {
  const unlocked = isUnlocked(u, stats, level);
  if (u.level) {
    const need = xpForLevel(u.level);
    return {
      kind: "xp",
      unlocked,
      how:
        u.level === 1
          ? "Everyone starts here"
          : `${unlocked ? "Reached" : "Reach"} level ${u.level} (${need.toLocaleString("en-US")} XP)`,
      have: xp,
      need,
      counts: ["XP comes from any useful testing work. See \"How you earned it\" above for your XP breakdown."],
    };
  }
  const have = stats[u.stat!];
  const need = u.atLeast!;
  const w = WHAT_COUNTS[u.stat!];
  return {
    kind: "work",
    unlocked,
    how: w ? (unlocked ? w.earned(have, need) : w.rule(need)) : unlockText(u),
    have,
    need,
    counts: w?.counts ?? [],
  };
}
