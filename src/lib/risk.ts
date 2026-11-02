// Risk board: each requirement in a release on a 3×3 grid of how likely it is to break
// (likelihood) against how much it would hurt (impact). Flaw Patrol makes a first guess from what
// it already knows, and people move cards to correct it. Client-safe; data lives in risk-data.ts.

export type Level = 1 | 2 | 3;
export const LEVEL_WORD: Record<Level, string> = { 1: "Low", 2: "Medium", 3: "High" };

export type RiskSignals = {
  /** Jira priority name, like "High" or "Not Prioritized". */
  priority: string;
  points: number | null;
  cases: number;
  /** Bugs ever found by this requirement's cases. */
  pastBugs: number;
  failing: boolean;
  /** False when the umbrella doesn't use Test cases: "No tests yet" is left out of the guess. */
  withCases?: boolean;
};

const HIGH_PRIORITY = ["highest", "blocker", "critical", "high", "major", "urgent"];
const LOW_PRIORITY = ["low", "lowest", "minor", "trivial"];

const clamp = (n: number): Level => (n <= 1 ? 1 : n >= 3 ? 3 : 2);

/** The first guess, with the reasons in plain words. */
export function guessRisk(s: RiskSignals): { likelihood: Level; impact: Level; reasons: string[] } {
  const reasons: string[] = [];
  const p = s.priority.trim().toLowerCase();
  let impact: Level = 2;
  if (HIGH_PRIORITY.includes(p)) {
    impact = 3;
    reasons.push(`${s.priority} priority in Jira`);
  } else if (LOW_PRIORITY.includes(p)) {
    impact = 1;
    reasons.push(`${s.priority} priority in Jira`);
  }
  let likely = 1;
  if (s.points != null && s.points >= 5) {
    likely++;
    reasons.push(`${s.points} story points, a big change`);
  }
  if (s.pastBugs) {
    likely += s.pastBugs >= 3 ? 2 : 1;
    reasons.push(`${s.pastBugs} ${s.pastBugs === 1 ? "bug" : "bugs"} found here before`);
  }
  if (s.failing) {
    likely++;
    reasons.push("Its cases are failing");
  }
  if (!s.cases && s.withCases !== false) {
    likely++;
    reasons.push("No tests yet");
  }
  if (!reasons.length) reasons.push("Nothing stands out");
  return { likelihood: clamp(likely), impact, reasons };
}

export type RiskLevel = "High" | "Med" | "Low";

/** One word for a cell: top right is High, bottom left is Low. */
export function riskLevel(likelihood: number, impact: number): RiskLevel {
  const n = likelihood * impact;
  return n >= 6 ? "High" : n >= 3 ? "Med" : "Low";
}

export const riskScore = (likelihood: number, impact: number) => likelihood * impact * 10 + impact;

/** How long a charter for a requirement with no tests should run, by its risk. */
export const charterMinutes = (level: RiskLevel) => (level === "High" ? 45 : level === "Med" ? 30 : 15);

export type PlanAction = "run" | "charter" | "skip";

/** What Plan this release picks for a requirement before anyone changes it. */
export function defaultAction(level: RiskLevel, cases: number): PlanAction {
  if (cases) return "run";
  return level === "Low" ? "skip" : "charter";
}
