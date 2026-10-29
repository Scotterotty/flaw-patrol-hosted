import type { ResultStatus } from "@prisma/client";

/** Step statuses of a saved result (its stepResults JSON), for the run list's pips. Null when it has none. */
export function resultSteps(json: unknown): ResultStatus[] | null {
  if (!Array.isArray(json)) return null;
  const steps = json.map((s) => (s && typeof s === "object" ? (s as { status?: ResultStatus }).status : undefined)).filter((s): s is ResultStatus => !!s);
  return steps.length ? steps : null;
}
