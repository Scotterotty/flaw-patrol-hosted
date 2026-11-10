import "server-only";
import { layoutFromSettings } from "./bug-layout";
import { parseTemplateSettings, templateKind } from "./bug-template";
import { jiraConfigFor } from "./umbrella";
import type { BashOko } from "./bash-oko";

/** The OKO layout and Team / Client/SKUs defaults when a bash's test cycle files OKO bugs (Settings → Jira), else null. */
export async function bashOkoFor(runProjectId: string): Promise<BashOko | null> {
  const t = parseTemplateSettings((await jiraConfigFor(runProjectId))?.bugTemplate);
  if (templateKind(t) !== "detailed") return null;
  const layout = layoutFromSettings(t);
  return layout ? { layout, defaults: { team: t.team, clients: t.clients } } : null;
}
