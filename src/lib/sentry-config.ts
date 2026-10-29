import "server-only";
import { db } from "./db";

/** Whether a test cycle can ask Sentry (ver_96): its own connection, else its umbrella's. */
export async function sentryConnected(projectId: string) {
  if (await db.sentryConfig.count({ where: { projectId } })) return true;
  const p = await db.project.findUnique({ where: { id: projectId }, select: { group: { select: { hubProjectId: true } } } });
  const hub = p?.group?.hubProjectId;
  return !!hub && (await db.sentryConfig.count({ where: { projectId: hub } })) > 0;
}
