"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { emailMatches, parseTemplateSettings, templateKind } from "@/lib/bug-template";
import { db } from "@/lib/db";
import { requireProjectAction, requireUser } from "@/lib/session";
import { readBugTemplate } from "./jira";
import { attempt, UserError } from "./result";

// Company bug templates. A workspace admin shares a bug layout with everyone whose
// email ends a certain way; their umbrellas and test cycles can then pick it. A shared
// template is one saved copy, so an admin's edit reaches every place that uses it.

async function requireWorkspaceAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new UserError("Only a workspace admin can do that.");
  return user;
}

/** "@Magnopus.com, partner.example" → ["magnopus.com", "partner.example"]. */
const domainsSchema = z
  .array(z.string().trim().toLowerCase().max(100))
  .max(20)
  .transform((list) => [...new Set(list.map((d) => d.replace(/^@/, "")).filter(Boolean))])
  .refine((list) => list.length > 0, "Add at least one email ending, like @yourcompany.com.")
  .refine((list) => list.every((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)), "Email endings look like @yourcompany.com.");

const shareSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(80),
  domains: domainsSchema,
  /** Where it starts: the ready-made layout, or the template a project uses now. */
  from: z.union([
    z.object({ kind: z.literal("readymade") }),
    z.object({ kind: z.literal("project"), projectId: z.string() }),
    /** Read one example bug through a place's Jira connection, like Import a template from Jira. */
    z.object({ kind: z.literal("import"), projectId: z.string(), example: z.string().max(500) }),
  ]),
});

/** Workspace settings → Bug templates → Share a template. */
export async function shareTemplate(input: z.input<typeof shareSchema>) {
  return attempt(async () => {
    const user = await requireWorkspaceAdmin();
    const data = shareSchema.parse(input);
    let settings: Prisma.InputJsonValue = { on: true, clientTag: "", team: "", clients: [], olyEnv: [], imported: null };
    let source = "Ready-made layout with a Reproduction History table";
    let fromProject: string | null = null;
    if (data.from.kind === "project") {
      const row = await db.jiraConfig.findUnique({ where: { projectId: data.from.projectId }, select: { bugTemplate: true, project: { select: { name: true } } } });
      const t = parseTemplateSettings(row?.bugTemplate);
      if (!row || templateKind(t) === "plain") throw new UserError("That one uses the plain layout. Pick a place with a bug template.");
      settings = t as unknown as Prisma.InputJsonValue;
      source = t.imported ? `Imported from Jira bug ${t.imported.from}` : `From ${row.project.name}`;
      fromProject = data.from.projectId;
    } else if (data.from.kind === "import") {
      const read = await readBugTemplate(data.from.projectId, data.from.example);
      if (!read.ok) throw new UserError(read.error);
      settings = { on: true, clientTag: "", team: "", clients: [], olyEnv: [], imported: read.template } as unknown as Prisma.InputJsonValue;
      source = `Imported from Jira bug ${read.template.from}`;
    }
    const tpl = await db.sharedBugTemplate.create({ data: { name: data.name, source, settings, domains: data.domains, createdBy: user.name ?? user.email } });
    // The place it came from switches to the shared copy.
    if (fromProject) await db.jiraConfig.update({ where: { projectId: fromProject }, data: { sharedTemplateId: tpl.id } });
    await logActivity({ actor: user, kind: "settings", action: `Shared the bug template ${data.name}`, detail: data.domains.map((d) => `@${d}`).join(", ") });
    revalidatePath("/", "layout");
    return { id: tpl.id };
  });
}

const editSchema = z.object({ name: z.string().trim().min(1, "Give the template a name.").max(80), domains: domainsSchema });

/** Rename a shared template or change whose emails can use it. */
export async function updateSharedTemplate(id: string, input: z.input<typeof editSchema>) {
  return attempt(async () => {
    const user = await requireWorkspaceAdmin();
    const data = editSchema.parse(input);
    await db.sharedBugTemplate.update({ where: { id }, data });
    await logActivity({ actor: user, kind: "settings", action: `Changed the shared bug template ${data.name}`, detail: data.domains.map((d) => `@${d}`).join(", ") });
    revalidatePath("/", "layout");
    return {};
  });
}

/** Stop sharing: places that use it keep their own copy of the layout. */
export async function stopSharing(id: string) {
  return attempt(async () => {
    const user = await requireWorkspaceAdmin();
    const tpl = await db.sharedBugTemplate.findUnique({ where: { id }, include: { configs: { select: { projectId: true, bugTemplate: true } } } });
    if (!tpl) return {};
    const shared = parseTemplateSettings(tpl.settings);
    await db.$transaction([
      ...tpl.configs.map((c) => {
        const own = parseTemplateSettings(c.bugTemplate);
        const copy = { ...shared, clientTag: shared.clientTag || own.clientTag, team: shared.team || own.team, clients: shared.clients.length ? shared.clients : own.clients, olyEnv: shared.olyEnv.length ? shared.olyEnv : own.olyEnv };
        return db.jiraConfig.update({ where: { projectId: c.projectId }, data: { bugTemplate: copy as unknown as Prisma.InputJsonValue, sharedTemplateId: null } });
      }),
      db.sharedBugTemplate.delete({ where: { id } }),
    ]);
    await logActivity({ actor: user, kind: "settings", action: `Stopped sharing the bug template ${tpl.name}`, detail: `${tpl.configs.length} kept their own copy` });
    revalidatePath("/", "layout");
    return {};
  });
}

/**
 * Settings → Bug template → Shared with you: use a company template here (or stop, with null).
 * Only someone whose email matches can pick it; every bug from here then uses it, whoever files it.
 */
export async function pickSharedTemplate(projectId: string, templateId: string | null) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    const row = await db.jiraConfig.findUnique({ where: { projectId }, select: { projectId: true } });
    if (!row) throw new UserError("Connect Jira first.");
    let name = "";
    if (templateId) {
      const tpl = await db.sharedBugTemplate.findUnique({ where: { id: templateId } });
      if (!tpl || !emailMatches(user.email, tpl.domains)) throw new UserError("That template isn't shared with your email.");
      name = tpl.name;
    }
    await db.jiraConfig.update({ where: { projectId }, data: { sharedTemplateId: templateId } });
    await logActivity({ actor: user, kind: "settings", action: templateId ? `Picked the shared bug template ${name}` : "Stopped using the shared bug template", project });
    revalidatePath(`/p/${project.key}/settings`);
    revalidatePath("/g", "layout");
    return {};
  });
}
