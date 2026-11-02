import "server-only";
import { db } from "./db";
import { digestSummary, parseDigestSettings, type DigestSettings } from "./digest-settings";
import { mailOn } from "./mail";

// What the Email digests card and the Email groups list show.

export type GroupView = { id: string; name: string; people: { id: string; name: string; email: string }[]; addresses: string[]; usedBy: string[]; createdBy: string };
export type PersonView = { id: string; name: string; email: string };

/** Every email group, with its people's names and the umbrellas and test cycles that use it. */
export async function emailGroupViews(): Promise<GroupView[]> {
  const [groups, umbrellas, cycles] = await Promise.all([
    db.emailGroup.findMany({ orderBy: { name: "asc" } }),
    db.projectGroup.findMany({ where: { hubProjectId: { not: null }, archivedAt: null }, select: { name: true, emailDigest: true } }),
    db.project.findMany({ where: { archivedAt: null, OR: [{ emailDigestMode: "choose" }, { groupId: null }] }, select: { name: true, emailDigest: true } }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: groups.flatMap((g) => g.userIds) } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, { id: u.id, name: u.name || u.email, email: u.email }]));
  const usesOf = [...umbrellas, ...cycles].map((x) => ({ name: x.name, ids: parseDigestSettings(x.emailDigest).groupIds }));
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    people: g.userIds.map((id) => byId.get(id)).filter((x): x is PersonView => !!x),
    addresses: g.addresses,
    usedBy: usesOf.filter((u) => u.ids.includes(g.id)).map((u) => u.name),
    createdBy: g.createdBy,
  }));
}

/** People to pick from: everyone on these teams (or everyone, for a workspace admin's list). */
export async function pickablePeople(projectIds: string[] | "all"): Promise<PersonView[]> {
  const users = await db.user.findMany({
    where: projectIds === "all" ? {} : { memberships: { some: { projectId: { in: projectIds } } } },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true },
    take: 500,
  });
  return users.map((u) => ({ id: u.id, name: u.name || u.email, email: u.email }));
}

export type DigestCardData = { settings: DigestSettings; summary: string; groups: GroupView[]; people: PersonView[]; mailOn: boolean; teamSize: number };

/** The Email digests card for an umbrella (its hub project and test cycles) or a lone test cycle. */
export async function digestCardData(saved: unknown, teamProjectIds: string[]): Promise<DigestCardData> {
  const settings = parseDigestSettings(saved);
  const [groups, people, on, team] = await Promise.all([
    emailGroupViews(),
    pickablePeople(teamProjectIds),
    mailOn(),
    db.projectMember.findMany({ where: { projectId: { in: teamProjectIds } }, distinct: ["userId"], select: { userId: true } }),
  ]);
  const names = settings.groupIds.map((id) => groups.find((g) => g.id === id)?.name).filter((n): n is string => !!n);
  return { settings, summary: digestSummary(settings, names), groups, people, mailOn: on, teamSize: team.length };
}
