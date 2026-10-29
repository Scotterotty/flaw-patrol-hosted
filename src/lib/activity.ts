import "server-only";
import { headers } from "next/headers";
import { ACTIVITY_KINDS, KEEP_CHOICES, type ActivityKind } from "./activity-query";
import { db } from "./db";

// Workspace settings → Activity log (ver_92). Admin and security events only:
// sign-ins, people and roles, settings, deletes and archives, runs opened and
// closed. Test results, cases run and bugs filed are never written here, and the
// log never shows per-person counts, so it can't be used to rank testers.

export { ACTIVITY_KINDS, KEEP_CHOICES, type ActivityKind };

type Actor = { id: string; name?: string | null; email: string } | { label: string };

export type ActivityInput = {
  actor: Actor | null;
  kind: ActivityKind;
  action: string;
  /** Where it happened; a project fills in its umbrella and name. */
  project?: { id: string; name: string; groupId?: string | null } | null;
  group?: { id: string; name: string } | null;
  detail?: string;
};

async function clientIp() {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

async function whereLabel(input: ActivityInput) {
  if (input.group) return { where: input.group.name, groupId: input.group.id, projectId: null };
  const p = input.project;
  if (!p) return { where: "Workspace", groupId: null, projectId: null };
  const group = await db.projectGroup.findFirst({
    where: { OR: [{ hubProjectId: p.id }, ...(p.groupId ? [{ id: p.groupId }] : [])] },
    select: { id: true, name: true, hubProjectId: true },
  });
  if (!group) return { where: p.name, groupId: null, projectId: p.id };
  return { where: group.hubProjectId === p.id ? group.name : `${group.name} · ${p.name}`, groupId: group.id, projectId: p.id };
}

/** Add one entry. Never throws: a log hiccup must not stop the thing being logged. */
export async function logActivity(input: ActivityInput) {
  try {
    const actor = input.actor;
    const place = await whereLabel(input);
    await db.activityEntry.create({
      data: {
        actorId: actor && "id" in actor ? actor.id : null,
        actorLabel: !actor ? "Flaw Patrol" : "id" in actor ? (actor.name ?? actor.email) : actor.label,
        kind: input.kind,
        action: input.action.slice(0, 300),
        detail: (input.detail ?? "").slice(0, 500),
        ip: await clientIp(),
        ...place,
      },
    });
  } catch (e) {
    console.error("Activity log:", e);
  }
}

/** Remove entries older than the workspace's keep-for setting. */
export async function pruneActivity() {
  const ws = await db.workspace.findUnique({ where: { id: 1 }, select: { activityKeepDays: true } });
  const days = ws?.activityKeepDays ?? 365;
  await db.activityEntry.deleteMany({ where: { at: { lt: new Date(Date.now() - days * 86_400_000) } } });
}
