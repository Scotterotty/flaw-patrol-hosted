// Why a case was flagged for attention. Kept apart from the server actions so pages can read it.
export const FLAG_REASONS = {
  NEEDS_UPDATE: "Needs updating",
  UNCLEAR: "Steps unclear",
  WRONG_EXPECTED: "Wrong expected result",
  OTHER: "Needs attention",
  /** Made with a title only, from a requirement; clears itself once a step is written. */
  NEEDS_STEPS: "Needs steps",
} as const;
export type FlagReason = keyof typeof FLAG_REASONS;

export type CaseFlagInfo = { reason: FlagReason; note: string; by: string; ago: string; runNumber: number | null };

export function flagLabel(reason: string | null | undefined): string {
  return reason && reason in FLAG_REASONS ? FLAG_REASONS[reason as FlagReason] : FLAG_REASONS.OTHER;
}

/** The flag as pages show it, or null when the case isn't flagged. */
export function flagInfo(c: { flag: string | null; flagNote: string; flaggedBy: string; flaggedAt: Date | null; flagRunNumber: number | null }, ago: (d: Date) => string): CaseFlagInfo | null {
  if (!c.flag) return null;
  return {
    reason: (c.flag in FLAG_REASONS ? c.flag : "OTHER") as FlagReason,
    note: c.flagNote,
    by: c.flaggedBy,
    ago: c.flaggedAt ? ago(c.flaggedAt) : "",
    runNumber: c.flagRunNumber,
  };
}
