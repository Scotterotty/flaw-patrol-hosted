"use server";

import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

const personaSchema = z.object({
  name: z.string().trim().min(1, "Give the persona a name").max(80),
  emoji: z.string().trim().min(1).max(16).default("🧑"),
  description: z.string().trim().max(500).default(""),
});

/** Add a persona to the project's list, or change one. */
export async function savePersona(projectId: string, personaId: string | null, input: z.input<typeof personaSchema>) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "shared:manage");
    const data = personaSchema.parse(input);
    const clash = await db.persona.findFirst({ where: { projectId, name: { equals: data.name, mode: "insensitive" }, NOT: personaId ? { id: personaId } : undefined } });
    if (clash) throw new UserError(`There's already a persona called ${clash.name}.`);
    let id = personaId;
    if (personaId) {
      const found = await db.persona.findFirst({ where: { id: personaId, projectId } });
      if (!found) throw new UserError("That persona no longer exists.");
      await db.persona.update({ where: { id: personaId }, data });
    } else {
      id = (await db.persona.create({ data: { ...data, projectId } })).id;
    }
    revalidatePath(`/p/${project.key}`, "layout");
    return { id: id!, name: data.name, emoji: data.emoji };
  });
}

/** Archived personas drop out of pickers; cases tagged with one keep the tag. */
export async function setPersonaArchived(projectId: string, personaId: string, archived: boolean) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "library:archive");
    const { count } = await db.persona.updateMany({ where: { id: personaId, projectId }, data: { archived } });
    if (!count) throw new UserError("That persona no longer exists.");
    const persona = await db.persona.findUnique({ where: { id: personaId }, select: { name: true } });
    await logActivity({ actor: user, kind: "delete", action: `${archived ? "Archived" : "Restored"} persona "${persona?.name ?? ""}"`, project });
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}
