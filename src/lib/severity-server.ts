import "server-only";
import { parseSeverityConfig, PLAIN_SCALE, scaleOf, type SeverityScale } from "./severity";
import { jiraConfigFor } from "./umbrella";

/** A project's severity names: from its Jira's severity field, else the plain list. */
export async function severityScaleFor(projectId: string | null | undefined): Promise<SeverityScale> {
  if (!projectId) return PLAIN_SCALE;
  const cfg = await jiraConfigFor(projectId);
  return cfg ? scaleOf(parseSeverityConfig(cfg.severity)) : PLAIN_SCALE;
}
