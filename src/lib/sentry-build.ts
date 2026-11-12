import "server-only";
import { parseFieldValues } from "./run-fields";
import type { SentryClient } from "./sentry";

// How a run's build finds its Sentry release: used by the Sentry card on a run page,
// Reports → RC status, and the Status page (ver_228).

/** The run's build, by the field Settings → Sentry says holds it. */
export function buildOf(run: { build: string; fields: unknown }, field: string) {
  if (!field) return "";
  if (field === "build") return run.build;
  return parseFieldValues(run.fields).find((f) => f.id === field)?.value ?? "";
}

/** The Sentry release for the run's build, or null when it has none. */
export function release(client: SentryClient, cfg: { buildField: string }, run: { build: string; fields: unknown }, ids: string[]) {
  const build = buildOf(run, cfg.buildField).trim();
  return build ? client.releaseFor(build, ids) : Promise.resolve(null);
}

