import "server-only";
import { db } from "@/lib/db";
import { NOT_PRACTICE } from "@/lib/practice";

/**
 * The Glossary is one list for everyone, shown inside a project's menu. A shared link
 * (/glossary or /glossary/<term>) opens it in the project this person visited last.
 */
export async function glossaryHome(user: { id: string; isAdmin: boolean }) {
  const recent = await db.projectPin.findFirst({
    where: { userId: user.id, visitedAt: { not: null }, project: { archivedAt: null, ...NOT_PRACTICE, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) } },
    orderBy: { visitedAt: "desc" },
    select: { project: { select: { key: true, groupId: true } } },
  });
  // A test cycle in an umbrella shows the umbrella's library pages on its hub.
  const p =
    recent?.project ??
    (await db.project.findFirst({ where: { archivedAt: null, ...NOT_PRACTICE, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) }, orderBy: { createdAt: "asc" }, select: { key: true, groupId: true } }));
  if (!p) return null;
  if (p.groupId) {
    const hub = await db.projectGroup.findUnique({ where: { id: p.groupId }, select: { hub: { select: { key: true } } } });
    if (hub?.hub) return `/p/${hub.hub.key}/glossary`;
  }
  return `/p/${p.key}/glossary`;
}
