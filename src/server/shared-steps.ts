"use server";

import { logActivity } from "@/lib/activity";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { placeholdersIn, plainStepSchema, sharedStepParamSchema } from "@/lib/steps";
import { attempt, UserError } from "./result";

const sharedInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().max(5000).default(""),
  parameters: z.array(sharedStepParamSchema).max(20).default([]),
  steps: z.array(plainStepSchema).min(1, "Add at least one step").max(100),
});
export type SharedStepInput = z.input<typeof sharedInputSchema>;

function normalize(input: SharedStepInput) {
  const data = sharedInputSchema.parse(input);
  const steps = data.steps.filter((s) => s.action.trim() || s.expected.trim());
  if (!steps.length) throw new UserError("Add at least one step.");
  const names = new Set<string>();
  for (const p of data.parameters) {
    if (names.has(p.name)) throw new UserError(`Parameter "${p.name}" is listed twice.`);
    names.add(p.name);
  }
  // Placeholders used in the text but not declared become parameters with no default.
  const parameters = [...data.parameters];
  for (const name of placeholdersIn(steps)) if (!names.has(name)) parameters.push({ name, defaultValue: "" });
  return { ...data, steps, parameters };
}

/** Create a shared step, or save a new version. Every case using it picks up the change. */
export async function saveSharedStep(projectId: string, sharedStepId: string | null, input: SharedStepInput) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "shared:manage");
    const data = normalize(input);
    const author = { authorId: user.id, authorName: user.name ?? user.email };
    const content = {
      name: data.name,
      description: data.description,
      parameters: data.parameters as Prisma.InputJsonValue,
      steps: data.steps as Prisma.InputJsonValue,
    };

    const result = await db.$transaction(async (tx) => {
      if (!sharedStepId) {
        const created = await tx.sharedStep.create({
          data: {
            projectId,
            name: data.name,
            description: data.description,
            currentVersion: 1,
            versions: { create: { ...content, ...author, version: 1 } },
          },
        });
        return { id: created.id, version: 1 };
      }
      const existing = await tx.sharedStep.findFirst({
        where: { id: sharedStepId, projectId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!existing) throw new UserError("Shared step not found.");
      const latest = existing.versions[0];
      if (
        latest &&
        latest.name === content.name &&
        latest.description === content.description &&
        JSON.stringify(latest.parameters) === JSON.stringify(content.parameters) &&
        JSON.stringify(latest.steps) === JSON.stringify(content.steps)
      ) {
        return { id: existing.id, version: existing.currentVersion };
      }
      const version = existing.currentVersion + 1;
      await tx.sharedStepVersion.create({ data: { ...content, ...author, sharedStepId, version } });
      await tx.sharedStep.update({
        where: { id: sharedStepId },
        data: { name: data.name, description: data.description, currentVersion: version },
      });
      return { id: existing.id, version };
    });

    revalidatePath(`/p/${project.key}`, "layout");
    return result;
  });
}

export async function setSharedStepArchived(projectId: string, sharedStepId: string, archived: boolean) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "library:archive");
    await db.sharedStep.updateMany({ where: { id: sharedStepId, projectId }, data: { archived } });
    const step = await db.sharedStep.findUnique({ where: { id: sharedStepId }, select: { name: true } });
    await logActivity({ actor: user, kind: "delete", action: `${archived ? "Archived" : "Restored"} shared step "${step?.name ?? ""}"`, project });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
