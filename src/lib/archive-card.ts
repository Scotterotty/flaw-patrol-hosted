import "server-only";
import { db } from "./db";
import { relativeTime } from "./format";
import { can, parseRoleRules } from "./permissions";
import { lastActivity } from "./project-visits";
import { mySpelling } from "./session";
import type { ArchiveCardData } from "@/components/archive-project";

type Viewer = { id: string; isAdmin: boolean };

/**
 * What the Archive… card at the bottom of Settings needs: the umbrella's test
 * cycles the viewer may archive (with open runs and last activity), what goes
 * with the whole umbrella, and the test cycle the page belongs to.
 */
export async function archiveCardData(user: Viewer, groupId: string | null, current: { id: string; name: string; archived: boolean } | null): Promise<ArchiveCardData | null> {
  const group = groupId ? await db.projectGroup.findUnique({ where: { id: groupId }, include: { hub: { include: { members: { where: { userId: user.id } } } } } }) : null;
  if (!group?.hub) return current ? { current, umbrella: null } : null;
  const hubRole = user.isAdmin ? "ADMIN" : (group.hub.members[0]?.role ?? null);
  const rules = parseRoleRules(group.roleRules);
  const canUmbrella = can({ role: hubRole, rules }, "umbrella:archive");
  const projects = await db.project.findMany({
    where: { groupId: group.id, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) },
    include: { members: { where: { userId: user.id } }, _count: { select: { runs: { where: { state: "ACTIVE" } } } } },
    orderBy: { createdAt: "desc" },
  });
  const mine = projects.filter((p) => user.isAdmin || can({ role: p.members[0]?.role ?? null, rules }, "cycle:archive"));
  if (!canUmbrella && !mine.length && !current) return null;
  const live = mine.filter((p) => !p.archivedAt);
  const activity = await lastActivity(live.map((p) => p.id));
  const spelling = await mySpelling();
  const now = new Date();
  const going = (
    await db.project.findMany({
      where: { groupId: group.id, ...(group.archivedAt ? { archivedWithUmbrella: true } : { archivedAt: null }) },
      select: { name: true },
      orderBy: { name: "asc" },
    })
  ).map((p) => p.name);
  return {
    current,
    umbrella: {
      id: group.id,
      name: group.name,
      archived: !!group.archivedAt,
      canArchive: canUmbrella,
      going,
      cycles: live.map((p) => {
        const at = activity.get(p.id);
        return { id: p.id, name: p.name, openRuns: p._count.runs, activity: at ? `active ${relativeTime(at, spelling, now)}` : "no activity yet" };
      }),
    },
  };
}
