import type { ResultStatus } from "@prisma/client";
import { withoutHeadings } from "./step-checks";

/**
 * Step statuses of a saved result (its stepResults JSON), for the run list's pips. Null when it has none.
 * `steps` is the run entry's saved copy of the steps: heading rows take no result, so they're left out.
 */
export function resultSteps(json: unknown, steps: unknown): ResultStatus[] | null {
  if (!Array.isArray(json)) return null;
  const list = withoutHeadings(steps, json).map((s) => (s && typeof s === "object" ? (s as { status?: ResultStatus }).status : undefined)).filter((s): s is ResultStatus => !!s);
  return list.length ? list : null;
}
