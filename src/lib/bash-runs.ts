// Bug bashes in run reports (ver_242). A bash is exploring, not a test cycle: Reports lists
// it apart, under Bug bashes, and leaves it out of pass rates and the manual numbers.
// Only when Runs is set to Bug bash do the numbers count them, since that's all there is.

/** The runs that count toward pass rates and the summary tiles. */
export const countedRuns = <R extends { bash?: boolean }>(runs: R[], kind?: string): R[] => (kind === "bash" ? runs : runs.filter((r) => !r.bash));

/** "OKO bug bash", without saying "bug bash" twice when the name already does. */
export const bashRowName = (name: string) => (/\bbash\b/i.test(name) ? name : `${name} bug bash`);
