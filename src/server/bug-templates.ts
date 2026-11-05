"use server";

// Settings → Bug templates: anyone who can make bug templates (Testers and up by
// default) adds and edits them; deleting is for admins by default. Bugs already reported keep
// their layout, so editing or deleting a template never changes them (Scott, ver_119).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { COLUMN_FILLS, layoutFromSettings, parseLayout, SOURCES } from "@/lib/bug-layout";
import { parseTemplateSettings } from "@/lib/bug-template";
import { jiraConfigFor } from "@/lib/umbrella";
import { loadBugTemplates, templateHome } from "@/lib/bug-templates-data";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

const line = (max: number) => z.string().trim().max(max).default("");

const layoutSchema = z.object({
  title: z.object({ platform: z.boolean(), area: z.boolean(), build: z.boolean() }),
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        heading: z.string().trim().min(1, "Give every heading a name.").max(120),
        source: z.enum(Object.keys(SOURCES) as [keyof typeof SOURCES]),
        hint: line(200),
        choices: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
        must: z.boolean().default(false),
        types: line(100),
        paste: z.boolean().default(false),
        columns: z
          .array(z.object({ name: z.string().trim().min(1, "Give every column a name.").max(60), fill: z.enum(Object.keys(COLUMN_FILLS) as [keyof typeof COLUMN_FILLS]) }))
          .max(12)
          .default([]),
        growing: z.boolean().default(false),
      }),
    )
    .min(1, "Add at least one heading.")
    .max(30),
  shot: z.boolean().default(false),
  fields: z.array(z.unknown()).max(60).default([]),
  from: line(40),
});

const templateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(80),
  hint: line(160),
  layout: layoutSchema,
});

/** The project id and key whose Settings page shows the list, and the home project the list lives on. */
async function homeFor(projectId: string, action: "bugtemplate:edit" | "bugtemplate:delete") {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, key: true, groupId: true, name: true } });
  const home = await templateHome(project);
  const { user } = await requireProjectAction(home.id, action);
  return { home, user, project };
}

function refresh(homeKey: string) {
  revalidatePath(`/p/${homeKey}`, "layout");
  revalidatePath("/g", "layout");
}

/** Make a new template, or save changes to one (`id`). */
export async function saveBugTemplate(projectId: string, input: z.input<typeof templateSchema> & { id?: string }) {
  return attempt(async () => {
    const { home, user, project } = await homeFor(projectId, "bugtemplate:edit");
    const data = templateSchema.parse(input);
    const layout = parseLayout(data.layout);
    for (const s of layout.sections) {
      if (s.source === "choice" && s.choices.length < 2) throw new UserError(`Give "${s.heading}" at least two choices.`);
      if (s.source === "table" && !s.columns.length) throw new UserError(`Give the table "${s.heading}" at least one column.`);
    }
    const clash = await db.bugTemplate.findFirst({ where: { projectId: home.id, name: { equals: data.name, mode: "insensitive" }, ...(input.id ? { NOT: { id: input.id } } : {}) } });
    if (clash) throw new UserError(`There's already a template called ${clash.name}. Pick another name.`);
    let id = input.id;
    if (id) {
      const { count } = await db.bugTemplate.updateMany({ where: { id, projectId: home.id }, data: { name: data.name, hint: data.hint, layout } });
      if (!count) throw new UserError("That template is gone. Someone may have deleted it.");
    } else {
      const last = await db.bugTemplate.findFirst({ where: { projectId: home.id }, orderBy: { position: "desc" }, select: { position: true } });
      ({ id } = await db.bugTemplate.create({
        data: { projectId: home.id, name: data.name, hint: data.hint, layout, position: (last?.position ?? 0) + 1, createdById: user.id, createdBy: user.name ?? user.email },
      }));
    }
    await logActivity({ actor: user, kind: "settings", action: `${input.id ? "Edited" : "Made"} the bug template ${data.name}`, project });
    refresh(home.key);
    return { id: id! };
  });
}

/** A copy named "… copy", right after the original. */
export async function duplicateBugTemplate(projectId: string, templateId: string) {
  return attempt(async () => {
    const { home, user } = await homeFor(projectId, "bugtemplate:edit");
    const t = await db.bugTemplate.findFirst({ where: { id: templateId, projectId: home.id } });
    if (!t) throw new UserError("That template is gone. Someone may have deleted it.");
    const names = new Set((await db.bugTemplate.findMany({ where: { projectId: home.id }, select: { name: true } })).map((x) => x.name.toLowerCase()));
    let name = `${t.name} copy`.slice(0, 80);
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${t.name} copy ${i}`.slice(0, 80);
    const copy = await db.bugTemplate.create({
      data: { projectId: home.id, name, hint: t.hint, layout: t.layout as object, position: t.position, createdById: user.id, createdBy: user.name ?? user.email },
    });
    refresh(home.key);
    return { id: copy.id, name };
  });
}

/** Delete a template. Bugs already reported with it keep their layout. */
export async function deleteBugTemplate(projectId: string, templateId: string) {
  return attempt(async () => {
    const { home, user, project } = await homeFor(projectId, "bugtemplate:delete");
    const t = await db.bugTemplate.findFirst({ where: { id: templateId, projectId: home.id } });
    if (!t) throw new UserError("That template is already gone.");
    await db.bugTemplate.delete({ where: { id: t.id } });
    await db.project.updateMany({ where: { id: home.id, bugTemplateDefault: t.id }, data: { bugTemplateDefault: "" } });
    await logActivity({ actor: user, kind: "settings", action: `Deleted the bug template ${t.name}`, project });
    refresh(home.key);
    return {};
  });
}

/** The template picked for people when they report a bug; "" is the current layout from Settings → Jira. */
export async function setDefaultBugTemplate(projectId: string, templateId: string) {
  return attempt(async () => {
    const { home, user, project } = await homeFor(projectId, "bugtemplate:edit");
    if (templateId && !(await db.bugTemplate.findFirst({ where: { id: templateId, projectId: home.id } }))) throw new UserError("That template is gone. Someone may have deleted it.");
    await db.project.update({ where: { id: home.id }, data: { bugTemplateDefault: templateId } });
    await logActivity({ actor: user, kind: "settings", action: "Changed the default bug template", project });
    refresh(home.key);
    return {};
  });
}

/** The bug form's choices for a test cycle. */
export async function bugTemplateChoices(projectId: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:execute");
    const t = await loadBugTemplates(project);
    // Write a bug files the first row (current layout) as a template too, so it needs it as one.
    const currentAsLayout = layoutFromSettings(parseTemplateSettings((await jiraConfigFor(projectId))?.bugTemplate));
    return { current: t.current, currentLayout: currentAsLayout, templates: t.templates.map(({ id, name, hint, layout }) => ({ id, name, hint, layout })), defaultId: t.defaultId };
  });
}
