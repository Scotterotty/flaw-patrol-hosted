import "server-only";
import { db } from "./db";
import type { Viewer } from "./whats-new";
import { NOT_PRACTICE } from "@/lib/practice";

/** Who's reading What's new: their highest role anywhere, the mini game, and an umbrella for Show me links. */
export async function viewerOf(user: { id: string; isAdmin: boolean; gameEnabled: boolean }): Promise<Viewer> {
  const roles = await db.projectMember.findMany({ where: { userId: user.id, project: NOT_PRACTICE }, select: { role: true }, distinct: ["role"] });
  const role = user.isAdmin ? "workspace" : roles.some((r) => r.role === "ADMIN") ? "admin" : roles.some((r) => r.role === "LEAD") ? "lead" : "all";
  const last = await db.projectPin.findFirst({
    where: { userId: user.id, visitedAt: { not: null }, project: { archivedAt: null, groupId: { not: null }, members: { some: { userId: user.id } } } },
    orderBy: { visitedAt: "desc" },
    select: { project: { select: { groupId: true } } },
  });
  const any = last ? null : await db.project.findFirst({ where: { archivedAt: null, groupId: { not: null }, members: { some: { userId: user.id } } }, select: { groupId: true } });
  return { role, game: user.gameEnabled, umbrella: last?.project.groupId ?? any?.groupId ?? null };
}
