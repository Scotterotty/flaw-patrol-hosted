import "server-only";
import { cleanPlatforms, parseAreas, phaseOf, releaseChoices, type BashLink } from "./bash";
import { BUILT_IN } from "./charter-templates";
import { charterHome, teamTemplates } from "./charter-data";
import { loadBugTemplates } from "./bug-templates-data";
import { db } from "./db";
import { storyInfo } from "./stories";
import { parsePlatforms, umbrellaOf } from "./umbrella";

// What the Start a bug bash box and the Bug bashes page need.

export type StartBoxData = {
  homeId: string;
  homeKey: string;
  homeName: string;
  /** Releases a bash can count toward (ver_152): the test cycles' saved releases, newest first. */
  releases: string[];
  suggestions: { name: string; hot: boolean; why: string; link?: BashLink }[];
  last: { name: string; areas: string[] } | null;
  templates: { id: string; name: string; group: string }[];
  slackChannels: number;
  /** Bug templates: the team's list and the default one; null is the plain one-line bug. */
  bugTemplates: { id: string; name: string; hint: string }[];
  bugTemplateDefault: string | null;
  /** Platforms (ver_146): the list to offer and whether "Ask people which platform they're on" starts on. */
  platforms: string[];
  askPlatform: boolean;
};

/** Where a project's bashes live: the umbrella's hub, or the project itself. */
export const bashHome = charterHome;

export async function startBoxData(project: { id: string; key: string; name: string; groupId: string | null }): Promise<StartBoxData> {
  // In two rounds instead of ten one after another.
  const [home, u] = await Promise.all([bashHome(project), umbrellaOf(project)]);
  const [homeRow, cycles, last, stories, folders, charters, team] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: home.id }, select: { id: true, key: true, name: true } }),
    u
      ? db.project.findMany({ where: { groupId: u.group.id, archivedAt: null, id: { not: u.hub.id } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, rcName: true, platform: true } })
      : Promise.resolve([]),
    db.bugBash.findFirst({ where: { projectId: home.id }, orderBy: { createdAt: "desc" }, select: { name: true, areas: true, platforms: true } }),
    // Suggestions: risky requirements first, then the library's top folders and its charters' areas.
    db.riskRating.findMany({ where: { projectId: home.id }, orderBy: { movedAt: "desc" }, take: 40, select: { issueKey: true, likelihood: true, impact: true } }).then(async (risky) => {
      const hot = risky.filter((r) => r.likelihood * r.impact >= 6);
      return hot.length ? [...(await storyInfo(home.id, [...new Set(hot.map((r) => r.issueKey))]).catch(() => new Map())).values()].filter((s) => !s.missing) : [];
    }),
    db.folder.findMany({ where: { projectId: home.id, parentId: null, name: { notIn: ["Bug bashes", "Automation"] } }, orderBy: { name: "asc" }, take: 8, select: { name: true } }),
    db.testCase.findMany({ where: { projectId: home.id, type: "EXPLORATORY", archived: false, folder: { name: { not: "Bug bashes" } } }, orderBy: { updatedAt: "desc" }, take: 6, select: { title: true } }),
    teamTemplates(home.id),
  ]);
  const bugTemplates = await loadBugTemplates(project).catch(() => null);
  const slackChannels = await db.slackChannel.count({ where: { paused: false, OR: [{ projectId: { in: [home.id, ...cycles.map((c) => c.id)] } }, ...(u ? [{ groupId: u.group.id }] : [])] } });
  const seen = new Set<string>();
  const suggestions: StartBoxData["suggestions"] = [];
  const add = (name: string, hot: boolean, why: string, link?: BashLink) => {
    const n = name.trim().slice(0, 120);
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    suggestions.push({ name: n, hot, why, ...(link && { link }) });
  };
  // A risky requirement carries its Jira link into the area.
  for (const s of stories) add(s.title, true, `High on the Risk board (${s.key})`, { kind: "jira", key: s.key, title: s.title, url: s.url ?? "" });
  for (const f of folders) add(f.name, false, "A Case library folder");
  for (const c of charters) add(c.title, false, "An existing charter");
  // Platforms: the umbrella's when it has them, else the ones the last bash asked about.
  const fromUmbrella = u ? cleanPlatforms(parsePlatforms(u.group.platforms).map((p) => p.name)) : [];
  const fromLast = cleanPlatforms(last?.platforms ?? []);
  return {
    homeId: homeRow.id,
    homeKey: homeRow.key,
    homeName: u?.group.name ?? homeRow.name,
    // Kept apart from releases unless someone picks one by name.
    releases: releaseChoices(cycles.map((c) => c.rcName)).slice(0, 6),
    suggestions: suggestions.slice(0, 10),
    last: last ? { name: last.name, areas: parseAreas(last.areas).map((a) => a.name) } : null,
    templates: [...BUILT_IN, ...team].map((t) => ({ id: t.id, name: t.name, group: t.group })),
    slackChannels,
    bugTemplates: bugTemplates?.templates.map((t) => ({ id: t.id, name: t.name, hint: t.hint })) ?? [],
    bugTemplateDefault: bugTemplates?.defaultId || null,
    platforms: fromUmbrella.length ? fromUmbrella : fromLast,
    askPlatform: fromUmbrella.length > 0 || fromLast.length > 0,
  };
}

/** Releases a bash at this home can count toward (ver_152): its umbrella's test cycles' saved releases, newest first. */
export async function bashReleases(home: { id: string; groupId: string | null }) {
  const u = await umbrellaOf(home);
  if (!u) return [];
  const cycles = await db.project.findMany({ where: { groupId: u.group.id, archivedAt: null, id: { not: u.hub.id }, rcName: { not: "" } }, orderBy: { createdAt: "desc" }, select: { rcName: true } });
  return releaseChoices(cycles.map((c) => c.rcName)).slice(0, 6);
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
    endedAt: b.endedAt,
    createdBy: b.createdBy,
    createdById: b.createdById,
    people: b._count.people,
    bugs: b._count.items,
    areas: parseAreas(b.areas).length,
    areaNames: parseAreas(b.areas).map((a) => a.name),
    minutes: b.minutes,
    run: b.run ? { number: b.run.number, key: b.run.project.key } : null,
  }));
}

/** Risk board: when each requirement was last bashed, and the bugs its area found. */
export async function bashedRequirements(homeId: string) {
  const bashes = await db.bugBash.findMany({ where: { projectId: homeId }, orderBy: { startsAt: "asc" }, select: { startsAt: true, areas: true, items: { where: { kind: "bug", mergedIntoId: null }, select: { areaId: true } } } });
  const out = new Map<string, { at: string; bugs: number }>();
  for (const b of bashes)
    for (const a of parseAreas(b.areas))
      for (const l of a.links) if (l.kind === "jira") out.set(l.key, { at: b.startsAt.toISOString(), bugs: b.items.filter((i) => i.areaId === a.id).length });
  return Object.fromEntries(out);
}
