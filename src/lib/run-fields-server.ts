import { db } from "./db";
import { CSP_FIELD, parseRunFields, type RunField } from "./run-fields";
import { umbrellaOf } from "./umbrella";

/** The fields a test cycle's runs ask for: its umbrella's, or CSP version outside an umbrella. */
export async function runFieldsFor(projectId: string): Promise<RunField[]> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, groupId: true } });
  if (!project) return [];
  const u = await umbrellaOf(project);
  return u ? parseRunFields(u.group.runFields) : [CSP_FIELD];
}
