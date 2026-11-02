"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { charterHome } from "@/lib/charter-data";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

// Your team's charter templates: Save as template on any charter, for leads and
// admins (shared:manage, like shared steps). They show in the gallery under "Your team's".

const templateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(120),
  description: z.string().trim().max(200).default(""),
  with: z.string().trim().max(2000).default(""),
  discover: z.string().trim().max(2000).default(""),
  minutes: z.number().int().min(5).max(480),
  prompts: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
});

export async function saveCharterTemplate(projectId: string, input: z.input<typeof templateSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "shared:manage");
    const data = templateSchema.parse(input);
    const home = await charterHome(project);
    const clash = await db.charterTemplate.findFirst({ where: { projectId: home.id, name: { equals: data.name, mode: "insensitive" } } });
    if (clash) throw new UserError(`There's already a template called ${clash.name}. Pick another name.`);
    const t = await db.charterTemplate.create({ data: { ...data, projectId: home.id, createdById: user.id, createdBy: user.name ?? user.email } });
    revalidatePath(`/p/${home.key}/charters`, "layout");
    return { id: t.id };
  });
}

export async function deleteCharterTemplate(projectId: string, templateId: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "shared:manage");
    const home = await charterHome(project);
    const { count } = await db.charterTemplate.deleteMany({ where: { id: templateId, projectId: home.id } });
    if (!count) throw new UserError("That template is already gone.");
    revalidatePath(`/p/${home.key}/charters`, "layout");
    return {};
  });
}
