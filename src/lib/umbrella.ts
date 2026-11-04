import { splitCycles } from "@/lib/current-cycles";
import { cycleHash } from "@/lib/cycle-hash";
import { NOT_BASH_CASE, NOT_BASH_RUN } from "./bash-cases";
import { effectiveTemplate } from "./bug-template";
import "server-only";
import { cache } from "react";
import type { Prisma, Role } from "@prisma/client";
import { db } from "./db";
import { can, parseRoleRules, type Who } from "./permissions";
import { toolsOn, type ToolId } from "./tools";

// Umbrella projects. An umbrella is a project group with a hub project:
// the hub holds the shared library (cases, suites, shared steps, personas), the
// Jira connection and bug template, and the team. Its RC projects run tests from
// the hub's library, pick up its Jira setup unless they have their own, and get
// its members unless "Keep members separate" is on.

type Tx = Prisma.TransactionClient | typeof db;

const RANK: Record<Role, number> = { VIEWER: 0, TESTER: 1, LEAD: 2, ADMIN: 3 };

/** The umbrella a project belongs to, as hub or as one of its projects. */
export function umbrellaOf(project: { id: string; groupId: string | null }) {
  return umbrellaOfOnce(project.id, project.groupId);
}

const umbrellaOfOnce = cache(async (projectId: string, groupId: string | null) => {
  const project = { id: projectId, groupId };
  const asHub = await db.projectGroup.findUnique({ where: { hubProjectId: project.id }, include: { hub: { select: { id: true, key: true, name: true } } } });
  if (asHub) return { group: asHub, hub: asHub.hub!, isHub: true as const };
  if (!project.groupId) return null;
  const group = await db.projectGroup.findUnique({ where: { id: project.groupId }, include: { hub: { select: { id: true, key: true, name: true } } } });
  if (!group?.hub) return null;
  return { group, hub: group.hub, isHub: false as const };
});

/** Where a project's cases, suites and shared steps come from: its own, plus its umbrella hub's. */
export async function libraryProjectIds(project: { id: string; groupId: string | null }) {
  const u = await umbrellaOf(project);
  return u && !u.isHub ? [project.id, u.hub.id] : [project.id];
}

/**
 * Give an umbrella's projects the hub's team. Members added this way are marked
 * fromUmbrella, so they follow the hub (role changes, removals) while people
 * added to one project by hand stay as they are. Projects that keep members
 * separate lose their inherited members.
 */
export async function syncUmbrellaMembers(groupId: string, tx: Tx = db) {
  const group = await tx.projectGroup.findUnique({ where: { id: groupId }, select: { hubProjectId: true } });
  if (!group?.hubProjectId) return;
  const hubMembers = await tx.projectMember.findMany({ where: { projectId: group.hubProjectId } });
  const kids = await tx.project.findMany({ where: { groupId }, select: { id: true, keepMembersSeparate: true, members: true } });
  for (const kid of kids) {
    const inherited = kid.members.filter((m) => m.fromUmbrella);
    if (kid.keepMembersSeparate) {
      if (inherited.length) await tx.projectMember.deleteMany({ where: { projectId: kid.id, fromUmbrella: true } });
      continue;
    }
    for (const hm of hubMembers) {
      const mine = kid.members.find((m) => m.userId === hm.userId);
      if (!mine) await tx.projectMember.create({ data: { projectId: kid.id, userId: hm.userId, role: hm.role, fromUmbrella: true } });
      else if (mine.fromUmbrella && mine.role !== hm.role) await tx.projectMember.update({ where: { projectId_userId: { projectId: kid.id, userId: hm.userId } }, data: { role: hm.role } });
    }
    const gone = inherited.filter((m) => !hubMembers.some((h) => h.userId === m.userId)).map((m) => m.userId);
    if (gone.length) await tx.projectMember.deleteMany({ where: { projectId: kid.id, fromUmbrella: true, userId: { in: gone } } });
  }
}

/** Everyone on any of these projects, at their highest role: the starting team for a new umbrella hub. */
export async function unionMembers(projectIds: string[]) {
  const rows = await db.projectMember.findMany({ where: { projectId: { in: projectIds } } });
  const best = new Map<string, Role>();
  for (const r of rows) if (!best.has(r.userId) || RANK[r.role] > RANK[best.get(r.userId)!]) best.set(r.userId, r.role);
  return [...best.entries()].map(([userId, role]) => ({ userId, role }));
}

/** A project's Jira settings: its own, or its umbrella hub's when it has none. */
export async function jiraConfigFor(projectId: string) {
  const own = await db.jiraConfig.findUnique({ where: { projectId }, include: { sharedTemplate: { select: { settings: true } } } });
  const p = own ? null : await db.project.findUnique({ where: { id: projectId }, select: { group: { select: { hubProjectId: true } } } });
  const hub = p?.group?.hubProjectId;
  const row = own ?? (hub && hub !== projectId ? await db.jiraConfig.findUnique({ where: { projectId: hub }, include: { sharedTemplate: { select: { settings: true } } } }) : null);
  if (!row) return null;
  // A company template stands in for the project's own layout while it's picked.
  const { sharedTemplate, ...rest } = row;
  return sharedTemplate ? { ...rest, bugTemplate: effectiveTemplate(row.bugTemplate, sharedTemplate.settings) as unknown as Prisma.JsonValue } : rest;
}

/** One shortcut on an umbrella's card: a page anywhere in it, by path. */
export type Shortcut = { label: string; sub: string; href: string; icon: ShortcutIcon };
export const SHORTCUT_ICONS = ["play", "book", "layers", "link", "bug", "user", "folder", "chart", "down", "cog"] as const;
export type ShortcutIcon = (typeof SHORTCUT_ICONS)[number];
export const MAX_SHORTCUTS = 6;

export function parseShortcuts(v: unknown): Shortcut[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is Shortcut => !!s && typeof s.label === "string" && typeof s.href === "string" && s.href.startsWith("/"))
    .map((s) => ({ label: s.label, sub: typeof s.sub === "string" ? s.sub : "", href: s.href, icon: (SHORTCUT_ICONS as readonly string[]).includes(s.icon) ? s.icon : "link" }))
    .slice(0, MAX_SHORTCUTS);
}

/**
 * A platform the umbrella tests on, with the hub suites each new release project runs, or
 * the cases picked from folders for it, remembered for its next release.
 */
export type Platform = { name: string; suiteIds: string[]; caseIds?: string[]; crownName?: string };
export function parsePlatforms(v: unknown): Platform[] {
  if (!Array.isArray(v)) return [];
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  return v
    .filter((p): p is Platform => !!p && typeof p.name === "string" && p.name.trim() !== "")
    .map((p) => {
      const caseIds = ids(p.caseIds);
      // Mini game crowns: an optional name for the platform's crown, e.g. "Ruler of the Web".
      const crownName = typeof p.crownName === "string" ? p.crownName.trim().slice(0, 40) : "";
      return { name: p.name.trim(), suiteIds: ids(p.suiteIds), ...(caseIds.length ? { caseIds } : {}), ...(crownName ? { crownName } : {}) };
    });
}

/**
 * What a new release's test cycle carries over from the last release when it starts with no runs
 *: who had each case and which cases still have open bugs. Its first run uses it.
 */
export type CarryOver = { from: string; assigned: Record<string, string>; recheck: string[] };
export function parseCarryOver(v: unknown): CarryOver | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const assigned = o.assigned && typeof o.assigned === "object" ? Object.fromEntries(Object.entries(o.assigned as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
  const recheck = Array.isArray(o.recheck) ? o.recheck.filter((s): s is string => typeof s === "string") : [];
  if (!Object.keys(assigned).length && !recheck.length) return null;
  return { from: typeof o.from === "string" ? o.from : "", assigned, recheck };
}

/**
 * Turn a pasted Flaw Patrol link into a path inside the app, or null.
 * Any host is fine (the app may be opened under different names); only the path is kept.
 */
export function linkPath(input: string) {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = s.startsWith("/") ? new URL(s, "http://x") : new URL(s);
    if (!/^(\/p\/|\/g\/|\/rc|\/account|\/$)/.test(u.pathname)) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/** Dot colors for platforms, in the order they're listed (Unity blue, Unreal red, Web green…). */
export const PLATFORM_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];
export function platformColor(platforms: Platform[], name: string) {
  const i = platforms.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  return i < 0 ? "#94a3b8" : PLATFORM_COLORS[i % PLATFORM_COLORS.length];
}

type Viewer = { id: string; isAdmin: boolean };

/**
 * Everything the umbrella's pages and menu need: the group, its hub, the viewer's
 * role there, and its projects split into the current RC per platform and older ones.
 * Null when the group isn't an umbrella or the viewer isn't on its team.
 */
export function loadUmbrella(groupId: string, user: Viewer) {
  return loadUmbrellaOnce(groupId, user.id, !!user.isAdmin);
}

// The layout, the left menu and the page each ask for the umbrella; one load per page view.
const loadUmbrellaOnce = cache(async (groupId: string, userId: string, isAdmin: boolean) => {
  const user = { id: userId, isAdmin };
  // The umbrella and its test cycles together: the cycles only need the id, so they don't wait.
  const [group, projects] = await Promise.all([
    db.projectGroup.findUnique({ where: { id: groupId }, include: { hub: { include: { members: { where: { userId: user.id } } } } } }),
    db.project.findMany({
      where: { groupId, ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }) },
      include: { _count: { select: { runs: { where: { state: "ACTIVE", ...NOT_BASH_RUN } } } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!group?.hub) return null;
  const hub = group.hub;
  const role: Role | null = user.isAdmin ? "ADMIN" : (hub.members[0]?.role ?? null);
  if (!role) return null;
  const who: Who = { role, rules: parseRoleRules(group.roleRules) };
  const platforms = parsePlatforms(group.platforms);
  // The newest live project for each platform is "current"; projects without a platform always are,
  // and so are ones pinned with Keep in Current. See splitCycles.
  // In an archived umbrella, the projects archived with it still count as live.
  const live = (p: (typeof projects)[number]) => !p.archivedAt || (!!group.archivedAt && p.archivedWithUmbrella);
  const { current, older } = splitCycles(projects, live, platforms.map((p) => p.name));
  const ids = [hub.id, ...projects.map((p) => p.id)];
  const [cases, charters, suites, shared, personas, activeRuns, openBugs, repos, liveBash] = await Promise.all([
    // Charters have their own page since ver_93, so the Case library counts only cases.
    db.testCase.count({ where: { projectId: hub.id, archived: false, type: { not: "EXPLORATORY" } } }),
    db.testCase.count({ where: { projectId: hub.id, archived: false, type: "EXPLORATORY", ...NOT_BASH_CASE } }),
    db.testSuite.count({ where: { projectId: hub.id, archived: false } }),
    db.sharedStep.count({ where: { projectId: hub.id, archived: false } }),
    db.persona.count({ where: { projectId: hub.id, archived: false } }),
    db.testRun.count({ where: { projectId: { in: ids }, state: "ACTIVE", ...NOT_BASH_RUN } }),
    openBugCount(ids),
    db.gitHubRepo.count({ where: { groupId } }),
    liveBashOf(hub.id),
  ]);
  return { group, hub, role, who, platforms, projects, current, older, live: liveBash, tools: toolsOn(group.tools), counts: { cases, charters, suites, shared, personas, activeRuns, openBugs, repos } };
});
export type Umbrella = NonNullable<Awaited<ReturnType<typeof loadUmbrella>>>;

/** Open bugs across these projects, counting a Jira issue filed from two projects once. */
export async function openBugCount(projectIds: string[]) {
  const rows = await db.defect.findMany({
    where: { projectId: { in: projectIds }, ...OPEN_BUG },
    select: { id: true, externalKey: true },
  });
  return new Set(rows.map((r) => r.externalKey ?? r.id)).size;
}
/** Open in Flaw Patrol and not done in Jira. */
export const OPEN_BUG = {
  status: "OPEN" as const,
  OR: [{ externalCategory: null }, { externalCategory: { not: "done" } }],
};

/** What the umbrella menu shows. Plain data, so the client menu can draw it. */
export type UmbrellaNav = {
  id: string;
  name: string;
  hubKey: string;
  counts: { cases: number; charters: number; suites: number; shared: number; personas: number; activeRuns: number; openBugs: number; repos: number };
  /** A bug bash running now, for the Live dot and the Join pill. */
  live: LiveBash | null;
  current: { key: string; name: string; color: string; platform: string; rc: string }[];
  older: number;
  archived: boolean;
  /** Tools that are on; off ones leave the menu. */
  tools: ToolId[];
  /** Admins see + Add tools when some are off. */
  canTools: boolean;
  /** Can write bugs here: Bugs in the menu gets a + for Write a bug. */
  canBug: boolean;
  /** The test cycle you're in, when the menu is shown on one of its pages. */
  cycle?: { key: string; name: string; color: string; older: boolean; ownCases: number; quests: boolean };
};
export function navOf(u: Umbrella): UmbrellaNav {
  return {
    id: u.group.id,
    name: u.group.name,
    hubKey: u.hub.key,
    counts: u.counts,
    live: u.live,
    // "Unity RC22" rather than "OKO Unity RC22": the menu already says OKO.
    current: u.current.map((p) => ({
      key: p.key,
      name: p.name.startsWith(`${u.group.name} `) ? p.name.slice(u.group.name.length + 1) : p.name,
      color: platformColor(u.platforms, p.platform),
      platform: p.platform,
      rc: p.rcName,
    })),
    older: u.older.length,
    archived: !!u.group.archivedAt,
    tools: u.tools,
    canTools: u.role === "ADMIN" && !u.group.archivedAt,
    canBug: can(u.who, "run:execute") && !u.group.archivedAt,
  };
}

/** The umbrella whose hub this project is, if any. */
/** Where a test cycle's Settings really lives, so links go straight there with no redirect hop. Same rules as /p/KEY/settings. */
export async function cycleSettingsHref(project: { id: string; key: string; groupId: string | null }, user: Viewer, hash = "") {
  const hub = await hubGroupId(project.id);
  if (hub) return `/g/${hub}/settings${hash ? `#${hash}` : ""}`;
  if (project.groupId && (await loadUmbrella(project.groupId, user))) return `/g/${project.groupId}/settings#${hash === "roles" ? "roles" : cycleHash(project.key)}`;
  return `/p/${project.key}/settings${hash ? `#${hash}` : ""}`;
}

export const hubGroupId = cache(async (projectId: string) => {
  return (await db.projectGroup.findUnique({ where: { hubProjectId: projectId }, select: { id: true } }))?.id ?? null;
});

/** Projects the viewer could move into an umbrella: not a hub, not archived, and not in an umbrella already. */
export async function looseProjects(user: Viewer) {
  const rows = await db.project.findMany({
    where: {
      hubOf: null,
      archivedAt: null,
      OR: [{ groupId: null }, { group: { hubProjectId: null } }],
      ...(user.isAdmin ? {} : { members: { some: { userId: user.id, role: { in: ["ADMIN", "LEAD"] } } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, key: true, name: true, _count: { select: { cases: { where: { archived: false } } } } },
  });
  return rows.map((p) => ({ id: p.id, key: p.key, name: p.name, cases: p._count.cases }));
}

export type LiveBash = { id: string; name: string; endsAt: string };

/** The bug bash running now in this hub (or test cycle outside an umbrella), if any. */
export const liveBashOf = cache(async (projectId: string): Promise<LiveBash | null> => {
  const now = new Date();
  const b = await db.bugBash.findFirst({
    where: { projectId, endedAt: null, wrappedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: "desc" },
    select: { id: true, name: true, endsAt: true },
  });
  return b ? { id: b.id, name: b.name, endsAt: b.endsAt.toISOString() } : null;
});
