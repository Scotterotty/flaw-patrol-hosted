"use server";

import { logActivity } from "@/lib/activity";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseRoleRules, ROLE_ROWS } from "@/lib/permissions";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

// The Roles card (ver_82): what each role can do, saved on the umbrella (for its hub and
// every test cycle in it) or on a test cycle that isn't in one. Admins only.

const rulesSchema = z.object({
  preset: z.enum(["everyone", "tighter", "custom"]),
  allow: z.record(z.string(), z.array(z.enum(["TESTER", "LEAD"]))).optional(),
});

export async function saveRoleRules(target: { groupId: string } | { projectId: string }, input: z.input<typeof rulesSchema>) {
  return attempt(async () => {
    const data = rulesSchema.parse(input);
    const ids = new Set(ROLE_ROWS.map((r) => r.id));
    const allow = data.preset === "custom" ? Object.fromEntries(Object.entries(data.allow ?? {}).filter(([k]) => ids.has(k) && !ROLE_ROWS.find((r) => r.id === k)?.locked)) : undefined;
    const value = data.preset === "everyone" ? null : parseRoleRules({ preset: data.preset, allow });
    const json = (value ?? undefined) as Prisma.InputJsonValue | undefined;
    if ("groupId" in target) {
      const group = await db.projectGroup.findUnique({ where: { id: target.groupId }, select: { id: true, name: true, hubProjectId: true } });
      if (!group?.hubProjectId) throw new UserError("This isn't an umbrella.");
      const { user } = await requireProjectAction(group.hubProjectId, "members:manage");
      await db.projectGroup.update({ where: { id: group.id }, data: { roleRules: json ?? Prisma.DbNull, rolesChosenAt: new Date() } });
      await logActivity({ actor: user, kind: "people", action: "Changed what each role can do", group, detail: `Preset: ${data.preset}` });
      revalidatePath("/", "layout");
    } else {
      const { project, user } = await requireProjectAction(target.projectId, "members:manage");
      if (project.groupId && (await db.projectGroup.findFirst({ where: { id: project.groupId, hubProjectId: { not: null } } }))) throw new UserError("This test cycle follows its umbrella's What can they do card. Change it in the umbrella's settings.");
      await db.project.update({ where: { id: project.id }, data: { roleRules: json ?? Prisma.DbNull, rolesChosenAt: new Date() } });
      await logActivity({ actor: user, kind: "people", action: "Changed what each role can do", project, detail: `Preset: ${data.preset}` });
      revalidatePath(`/p/${project.key}`, "layout");
    }
    return {};
  });
}

/**
 * "Keep everyone open" on the before-invite reminder (ver_96): the admin is happy with the
 * defaults, so the reminder stops showing. Nothing else changes.
 */
export async function keepEveryoneOpen(target: { groupId: string } | { projectId: string }) {
  return attempt(async () => {
    if ("groupId" in target) {
      const group = await db.projectGroup.findUnique({ where: { id: target.groupId }, select: { id: true, hubProjectId: true } });
      if (!group?.hubProjectId) throw new UserError("This isn't an umbrella.");
      await requireProjectAction(group.hubProjectId, "members:manage");
      await db.projectGroup.update({ where: { id: group.id }, data: { rolesChosenAt: new Date() } });
    } else {
      const { project } = await requireProjectAction(target.projectId, "members:manage");
      await db.project.update({ where: { id: project.id }, data: { rolesChosenAt: new Date() } });
    }
    revalidatePath("/", "layout");
    return {};
  });
}
