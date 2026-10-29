import "server-only";
import { parseAreas, phaseOf } from "./bash";
import { BUILT_IN } from "./charter-templates";
import { charterHome, teamTemplates } from "./charter-data";
import { db } from "./db";
import { storyInfo } from "./stories";
import { umbrellaOf } from "./umbrella";

// What the Start a bug bash box and the Bug bashes page need (ver_93).

export type StartBoxData = {
  homeId: string;
  homeKey: string;
  homeName: string;
  cycles: { id: string; name: string }[];
  defaultCycleId: string;
  suggestions: { name: string; hot: boolean; why: string }[];
  last: { name: string; areas: string[] } | null;
  templates: { id: string; name: string; group: string }[];
  slackChannels: number;
};

/** Where a project's bashes live: the umbrella's hub, or the project itself. */
export const bashHome = charterHome;

export async function startBoxData(project: { id: string; key: string; name: string; groupId: string | null }): Promise<StartBoxData> {
  const home = await bashHome(project);
  const u = await umbrellaOf(project);
  const homeRow = await db.project.findUniqueOrThrow({ where: { id: home.id }, select: { id: true, key: true, name: true } });
  const cycles = u
    ? await db.project.findMany({ where: { groupId: u.group.id, archivedAt: null, id: { not: u.hub.id } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, rcName: true, platform: true } })
    : [];
  const last = await db.bugBash.findFirst({ where: { projectId: home.id }, orderBy: { createdAt: "desc" }, select: { name: true, areas: true } });
  // Suggestions: risky requirements first, then the library's top folders and its charters' areas.
  const risky = await db.riskRating.findMany({ where: { projectId: home.id }, orderBy: { movedAt: "desc" }, take: 40, select: { issueKey: true, likelihood: true, impact: true } });
  const hot = risky.filter((r) => r.likelihood * r.impact >= 6);
  const stories = hot.length ? [...(await storyInfo(home.id, [...new Set(hot.map((r) => r.issueKey))]).catch(() => new Map())).values()].filter((s) => !s.missing) : [];
  const folders = await db.folder.findMany({ where: { projectId: home.id, parentId: null, name: { notIn: ["Bug bashes", "Automation"] } }, orderBy: { name: "asc" }, take: 8, select: { name: true } });
  const charters = await db.testCase.findMany({ where: { projectId: home.id, type: "EXPLORATORY", archived: false, folder: { name: { not: "Bug bashes" } } }, orderBy: { updatedAt: "desc" }, take: 6, select: { title: true } });
  const seen = new Set<string>();
  const suggestions: StartBoxData["suggestions"] = [];
  const add = (name: string, hot: boolean, why: string) => {
    const n = name.trim().slice(0, 120);
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    suggestions.push({ name: n, hot, why });
  };
  for (const s of stories) add(s.title, true, `High on the Risk board (${s.key})`);
  for (const f of folders) add(f.name, false, "A Case library folder");
  for (const c of charters) add(c.title, false, "An existing charter");
  const team = await teamTemplates(home.id);
  const slackChannels = await db.slackChannel.count({ where: { paused: false, OR: [{ projectId: { in: [home.id, ...cycles.map((c) => c.id)] } }, ...(u ? [{ groupId: u.group.id }] : [])] } });
  return {
    homeId: homeRow.id,
    homeKey: homeRow.key,
    homeName: u?.group.name ?? homeRow.name,
    // Kept apart from releases unless someone picks a test cycle (ver_94): the hub is "Don't attach".
    cycles: [{ id: homeRow.id, name: "" }, ...cycles.map((c) => ({ id: c.id, name: [c.name, c.platform && !c.name.includes(c.platform) ? c.platform : ""].filter(Boolean).join(" · ") }))],
    defaultCycleId: homeRow.id,
    suggestions: suggestions.slice(0, 10),
    last: last ? { name: last.name, areas: parseAreas(last.areas).map((a) => a.name) } : null,
    templates: [...BUILT_IN, ...team].map((t) => ({ id: t.id, name: t.name, group: t.group })),
    slackChannels,
  };
}

/** The Bug bashes page: what's live, what's coming, and past bashes. */
export async function bashList(homeId: string) {
  const rows = await db.bugBash.findMany({
    where: { projectId: homeId },
    orderBy: { startsAt: "desc" },
    take: 100,
    include: { _count: { select: { people: true, items: { where: { kind: "bug", mergedIntoId: null } } } }, run: { select: { number: true, project: { select: { key: true } } } } },
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    phase: phaseOf(b),
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    createdBy: b.createdBy,
    createdById: b.createdById,
    people: b._count.people,
    bugs: b._count.items,
    areas: parseAreas(b.areas).length,
    run: b.run ? { number: b.run.number, key: b.run.project.key } : null,
  }));
}
