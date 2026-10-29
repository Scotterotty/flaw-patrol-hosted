import "server-only";
import { effectiveTemplate, emailMatches, parseTemplateSettings, templateKind, type TemplateSettings } from "./bug-template";
import { db } from "./db";

// Company bug templates (ver_96): what a Bug template section and the Workspace settings tab show.

export type SharedChoice = { id: string; name: string; source: string; domains: string[]; title: string; kind: "plain" | "imported" | "detailed" };
export type SharedView = { choices: SharedChoice[]; current: SharedChoice | null };

/** The title shape a template gives bugs, as Settings shows it. */
export function templateTitle(t: TemplateSettings) {
  const kind = templateKind(t);
  if (kind === "imported" && t.imported) return [t.imported.title.tag && "[Tag]", t.imported.title.feature && "Feature", "Summary"].filter(Boolean).join(" - ");
  if (kind === "detailed") return `${t.clientTag ? `[${t.clientTag}]` : "[Tag]"} - Feature - Brief summary`;
  return "Summary";
}

const choiceOf = (t: { id: string; name: string; source: string; domains: string[]; settings: unknown }): SharedChoice => ({
  id: t.id,
  name: t.name,
  source: t.source,
  domains: t.domains,
  title: templateTitle(parseTemplateSettings(t.settings)),
  kind: templateKind(parseTemplateSettings(t.settings)),
});

/**
 * A project's Bug template as Settings shows it: the layout bugs really get (the shared one
 * when picked), the company templates this email may pick, and the one in use.
 */
export async function bugTemplateView(projectId: string, email: string) {
  const [row, all] = await Promise.all([
    db.jiraConfig.findUnique({ where: { projectId }, select: { bugTemplate: true, sharedTemplate: true } }),
    db.sharedBugTemplate.findMany({ orderBy: { name: "asc" } }),
  ]);
  const shared: SharedView = { choices: all.filter((t) => emailMatches(email, t.domains)).map(choiceOf), current: row?.sharedTemplate ? choiceOf(row.sharedTemplate) : null };
  return { template: effectiveTemplate(row?.bugTemplate, row?.sharedTemplate?.settings), shared };
}

/** Workspace settings → Bug templates: every shared template and how many places use it. */
export async function sharedTemplateList() {
  const all = await db.sharedBugTemplate.findMany({
    orderBy: { name: "asc" },
    include: { configs: { select: { project: { select: { name: true, hubOf: { select: { name: true } } } } } } },
  });
  return all.map((t) => ({
    ...choiceOf(t),
    createdBy: t.createdBy,
    usedIn: t.configs.map((c) => c.project.hubOf?.name ?? c.project.name),
  }));
}
export type SharedListItem = Awaited<ReturnType<typeof sharedTemplateList>>[number];

/** Where a shared template can start from: places with Jira and a bug template of their own. */
export async function shareSources() {
  const rows = await db.jiraConfig.findMany({
    where: { project: { archivedAt: null } },
    select: { projectId: true, jiraProjectKey: true, bugTemplate: true, tokenEncrypted: true, project: { select: { name: true, hubOf: { select: { name: true } }, group: { select: { name: true } } } } },
  });
  const label = (r: (typeof rows)[number]) => r.project.hubOf?.name ?? (r.project.group ? `${r.project.group.name} · ${r.project.name}` : r.project.name);
  return {
    /** "A template already in use". */
    inUse: rows.filter((r) => templateKind(parseTemplateSettings(r.bugTemplate)) !== "plain").map((r) => ({ id: r.projectId, label: label(r), title: templateTitle(parseTemplateSettings(r.bugTemplate)) })),
    /** "Import from a Jira bug": read through one of these Jira connections. */
    jira: rows.map((r) => ({ id: r.projectId, label: label(r), jiraKey: r.jiraProjectKey })),
  };
}
export type ShareSources = Awaited<ReturnType<typeof shareSources>>;
