import { ProjectMenu } from "@/components/project-menu";
import { db } from "@/lib/db";

/**
 * The left menu of the place you were in last, for pages outside any umbrella (Your account,
 * Not found). An umbrella's library shows the umbrella's own menu, so it never changes on you.
 */
export async function LastPlaceMenu({ user }: { user: { id: string; isAdmin: boolean; gameEnabled: boolean; questMap: boolean } }) {
  const last = await db.projectPin.findFirst({
    where: { userId: user.id, visitedAt: { not: null }, project: { archivedAt: null, members: { some: { userId: user.id } } } },
    orderBy: { visitedAt: "desc" },
    select: { project: { select: { id: true, key: true, name: true, groupId: true, platform: true } } },
  });
  return last ? <ProjectMenu project={last.project} user={user} /> : null;
}
