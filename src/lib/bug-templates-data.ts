// Bug templates: the list a test cycle's bug form offers, and Settings → Bug templates.
// Server only.

import { db } from "@/lib/db";
import { parseTemplateSettings, templateKind } from "@/lib/bug-template";
import { parseLayout, type BugLayout } from "@/lib/bug-layout";
import { umbrellaOf } from "@/lib/umbrella";

/** Where a test cycle's templates live: its umbrella's hub, or the test cycle itself outside one. */
export async function templateHome(project: { id: string; key: string; groupId: string | null }) {
  const u = await umbrellaOf(project);
  return u ? { id: u.hub.id, key: u.hub.key } : { id: project.id, key: project.key };
}

/**
 * The layout bugs used before ver_119, set in Settings → Jira (plain, the detailed layout, one
 * copied from a Jira bug, or a company template). It stays first in every list, so nobody has
 * to set anything up again.
 */
export type CurrentLayout = { name: string; kind: "plain" | "detailed" | "imported" | "shared" };

export async function currentLayout(projectId: string): Promise<CurrentLayout> {
  const own = await db.jiraConfig.findUnique({ where: { projectId }, select: { bugTemplate: true, sharedTemplate: { select: { name: true } } } });
  const p = own ? null : await db.project.findUnique({ where: { id: projectId }, select: { group: { select: { hubProjectId: true } } } });
  const hub = p?.group?.hubProjectId;
  const row = own ?? (hub && hub !== projectId ? await db.jiraConfig.findUnique({ where: { projectId: hub }, select: { bugTemplate: true, sharedTemplate: { select: { name: true } } } }) : null);
  if (!row) return { name: "Plain bug", kind: "plain" };
  if (row.sharedTemplate) return { name: row.sharedTemplate.name, kind: "shared" };
  const t = parseTemplateSettings(row.bugTemplate);
  const kind = templateKind(t);
  if (kind === "imported") return { name: `Layout from ${t.imported?.from ?? "Jira"}`, kind };
  if (kind === "detailed") return { name: "Detailed layout", kind };
  return { name: "Plain bug", kind: "plain" };
}

export type TemplateRow = { id: string; name: string; hint: string; layout: BugLayout; createdBy: string; updatedAt: string };

/** Everything the bug form and Settings need: the current layout, the team's templates and which one is the default. */
export async function loadBugTemplates(project: { id: string; key: string; groupId: string | null }) {
  const home = await templateHome(project);
  const [rows, homeRow, current] = await Promise.all([
    db.bugTemplate.findMany({ where: { projectId: home.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.project.findUnique({ where: { id: home.id }, select: { bugTemplateDefault: true } }),
    currentLayout(project.id),
  ]);
  const templates: TemplateRow[] = rows.map((r) => ({ id: r.id, name: r.name, hint: r.hint, layout: parseLayout(r.layout), createdBy: r.createdBy, updatedAt: r.updatedAt.toISOString() }));
  const want = homeRow?.bugTemplateDefault ?? "";
  const defaultId = templates.some((t) => t.id === want) ? want : "";
  return { home, current, templates, defaultId };
}

export type BugTemplates = Awaited<ReturnType<typeof loadBugTemplates>>;
