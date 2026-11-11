/**
 * First day (ver_216): small per-person choices about the Start here list, the "You're set" card
 * and the new-case form. Kept on the account in User.openCards as first:* words (like trends:*),
 * so they follow the person to every computer without a new table.
 */
export const FIRST_WORD = {
  /** Start here is hidden for now (✕ Hide for now, or Esc). Getting started in the account menu brings it back. */
  startHidden: "first:start-hidden",
  /** The one-time "You're set" card was closed. */
  setSeen: "first:set-seen",
  /** More details on a new case was left open. */
  caseDetails: "first:case-details",
} as const;
export type FirstWord = keyof typeof FIRST_WORD;

export function firstDay(openCards: string[] | null | undefined) {
  const has = (k: FirstWord) => (openCards ?? []).includes(FIRST_WORD[k]);
  return { startHidden: has("startHidden"), setSeen: has("setSeen"), caseDetails: has("caseDetails") };
}

export function withFirstWord(openCards: string[], k: FirstWord, on: boolean): string[] {
  const keep = openCards.filter((w) => w !== FIRST_WORD[k]);
  if (on) keep.push(FIRST_WORD[k]);
  return keep;
}
