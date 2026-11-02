// Bug bashes (persona audit #7): a bash makes a behind-the-scenes charter per area in a
// top-level "Bug bashes" folder, and a run in a test cycle. They stay with the bash (its results and
// report don't change), but they don't count as the team's test cases or as runs in progress.
import type { Prisma } from "@prisma/client";

export const BASH_FOLDER = "Bug bashes";

/** Leaves out the cases a bug bash made for its areas. */
export const NOT_BASH_CASE: Prisma.TestCaseWhereInput = { NOT: { type: "EXPLORATORY", folder: { is: { name: BASH_FOLDER, parentId: null } } } };

/** Leaves out a bug bash's run. */
export const NOT_BASH_RUN: Prisma.TestRunWhereInput = { bugBash: { is: null } };

/** Bug bashes going on right now, for "1 live bug bash". */
export const LIVE_BASH = (now: Date): Prisma.BugBashWhereInput => ({ endedAt: null, wrappedAt: null, startsAt: { lte: now }, endsAt: { gt: now } });
