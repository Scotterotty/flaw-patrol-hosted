// Runs started by picking cases (Pick cases, Whole Case library, Run selected, Ctrl+K)
// have no suite. When their cases are exactly a suite's cases, they count as that suite's run.

/** One key per case set, whatever the order. */
export const caseSetKey = (caseIds: string[]) => [...new Set(caseIds)].sort().join(",");

/** The first suite whose cases are exactly these cases, if any. */
export function suiteForCases<S extends { caseIds: string[] }>(suites: S[], caseIds: string[]): S | null {
  if (!caseIds.length) return null;
  const key = caseSetKey(caseIds);
  return suites.find((s) => s.caseIds.length && caseSetKey(s.caseIds) === key) ?? null;
}
