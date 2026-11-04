"use server";

import { refreshCrowns } from "@/lib/crowns";
import { suiteForCases } from "@/lib/suite-match";
import { logActivity } from "@/lib/activity";
import type { Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { pathOf } from "@/lib/folders";
import { canMakeUmbrellas, groupableProjectIds } from "@/lib/groups";
import { can, type Action } from "@/lib/permissions";
import { requireProjectAction, requireUser } from "@/lib/session";
import { type CarryOver, MAX_SHORTCUTS, OPEN_BUG, parsePlatforms, parseShortcuts, platformColor, SHORTCUT_ICONS, syncUmbrellaMembers, unionMembers } from "@/lib/umbrella";
import { attempt, UserError } from "./result";
import { keyCandidates } from "@/lib/cycle-key";
import { TOOL_IDS, toolsOn, toolsValue, type ToolId } from "@/lib/tools";
import { MAX_RUN_FIELDS, parseRunFields, type RunField } from "@/lib/run-fields";
import { fieldsOrFail } from "./run-field-input";
import { buildEntries } from "./snapshot";

// Umbrellas: a project group with a hub project holding the shared library, Jira
// and team. Anyone but a Viewer makes them; the hub's leads and admins run them.

const keySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "The key needs 2 to 10 letters or digits and must start with a letter.");
const nameSchema = z.string().trim().min(1, "Give the umbrella a name").max(60);

async function requireUmbrella(groupId: string, action: Action) {
  const group = await db.projectGroup.findUnique({ where: { id: groupId }, include: { hub: true } });
  if (!group?.hub) throw new UserError("This isn't an umbrella.");
  const { user, role } = await requireProjectAction(group.hub.id, action);
  return { user, role, group, hub: group.hub };
}

/** Archived umbrellas take no new projects until they're restored. */
function notArchived(group: { name: string; archivedAt: Date | null }) {
  if (group.archivedAt) throw new UserError(`${group.name} is archived. Restore it in ${group.name} settings first.`);
}

function refresh(groupId: string, hubKey?: string) {
  revalidatePath("/");
  revalidatePath(`/g/${groupId}`, "layout");
  if (hubKey) revalidatePath(`/p/${hubKey}`, "layout");
}

/** The hub project for an umbrella: everyone on its projects joins it, at their highest role, plus whoever made it as admin. */
async function makeHub(tx: Prisma.TransactionClient, groupId: string, name: string, key: string, description: string, projectIds: string[], creator: string) {
  if (await tx.project.findUnique({ where: { key } })) throw new UserError(`Key ${key} is already used.`);
  const team = await unionMembers(projectIds);
  const members = new Map<string, Role>(team.map((m) => [m.userId, m.role]));
  members.set(creator, "ADMIN");
  const hub = await tx.project.create({
    data: {
      key,
      name,
      description: description || `Case library, Jira and team for every ${name} test cycle`,
      members: { create: [...members].map(([userId, role]) => ({ userId, role })) },
    },
  });
  await tx.projectGroup.update({ where: { id: groupId }, data: { hubProjectId: hub.id } });
  return hub;
}

const newProjectSchema = z.object({
  platform: z.string().trim().max(30).default(""),
  name: z.string().trim().max(100).default(""),
});

/**
 * A new umbrella. It can make its first projects on the spot (one per platform,
 * named "<umbrella> <platform> <RC>" unless renamed) and take in projects that
 * already exist, whose libraries can come along. Everyone except Viewers; the maker becomes its Admin.
 */
export async function createUmbrella(input: {
  name: string;
  key: string;
  description?: string;
  projectIds?: string[];
  moveCases?: boolean;
  release?: string;
  newProjects?: z.input<typeof newProjectSchema>[];
  /** What will you use?: the tools that are on; left out means every tool. */
  tools?: ToolId[];
}) {
  return attempt(async () => {
    const user = await requireUser();
    if (!(await canMakeUmbrellas(user))) throw new UserError("Viewers can't make umbrellas. Ask an admin to make one, or to change your role.");
    const name = nameSchema.parse(input.name);
    const key = keySchema.parse(input.key);
    const description = z.string().trim().max(500).parse(input.description ?? "");
    const release = z.string().trim().max(30).parse(input.release ?? "");
    const tools = input.tools ? toolsValue(z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length).parse(input.tools)) : {};
    // Without Test runs there are no test cycles to make or move in.
    const withCycles = toolsOn(tools).includes("runs");
    const rows = z
      .array(newProjectSchema)
      .max(12, "Up to 12 test cycles at once.")
      .parse(withCycles ? (input.newProjects ?? []) : [])
      .filter((r) => r.platform || r.name)
      .map((r) => ({ platform: r.platform, name: r.name || projectNameFor(name, r.platform, release) }));
    const names = new Set<string>();
    for (const r of rows) {
      const k = r.name.toLowerCase();
      if (names.has(k)) throw new UserError(`Two new test cycles are both called ${r.name}. Rename one.`);
      names.add(k);
    }
    const clash = await db.projectGroup.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (clash) throw new UserError(`There's already a group called ${clash.name}.`);
    const picked = await groupableProjectIds(user, withCycles ? (input.projectIds ?? []) : []);
    // A project already under another umbrella stays there; move it from its own ⋯ menu instead.
    const ids = (await db.project.findMany({ where: { id: { in: picked }, hubOf: null, OR: [{ groupId: null }, { group: { hubProjectId: null } }] }, select: { id: true } })).map((p) => p.id);
    const group = await db.$transaction(async (tx) => {
      const g = await tx.projectGroup.create({ data: { name, description, tools } });
      if (ids.length) await tx.project.updateMany({ where: { id: { in: ids } }, data: { groupId: g.id } });
      const hub = await makeHub(tx, g.id, name, key, description, ids, user.id);
      for (const r of rows) {
        const projectKey = await freeKey(tx, hub.key, r.platform || r.name, release);
        await tx.project.create({
          data: { key: projectKey, name: r.name, groupId: g.id, platform: r.platform, rcName: release, description: [r.platform, release].filter(Boolean).join(" · ") },
        });
      }
      // New platforms show up in Start next release, ready for their suites (Change suites).
      const platforms = [...new Map(rows.filter((r) => r.platform).map((r) => [r.platform.toLowerCase(), r.platform])).values()];
      if (platforms.length) await tx.projectGroup.update({ where: { id: g.id }, data: { platforms: platforms.map((p) => ({ name: p, suiteIds: [] })) } });
      await syncUmbrellaMembers(g.id, tx);
      return g;
    });
    refresh(group.id);
    await logActivity({ actor: user, kind: "settings", action: `Made umbrella ${group.name}`, group, detail: rows.length ? `${rows.length} new test cycle${rows.length === 1 ? "" : "s"}` : "" });
    if (input.moveCases) for (const id of ids) {
      const r = await moveCasesIntoUmbrella(group.id, id);
      if (!r.ok) throw new UserError(`${group.name} was made, but moving cases stopped: ${r.error}`);
    }
    return { id: group.id };
  });
}

/** "OKO Web RC23": the umbrella, the platform, then the release, skipping whichever is blank. */
function projectNameFor(umbrella: string, platform: string, release: string) {
  return [umbrella, platform, release].filter(Boolean).join(" ");
}

/** Turn an existing project group into an umbrella. Its projects stay as they are; the team of all of them becomes the umbrella's. */
export async function makeUmbrella(groupId: string, keyInput: string) {
  return attempt(async () => {
    const user = await requireUser();
    if (!user.isAdmin) throw new UserError("Only workspace admins can make umbrellas.");
    const key = keySchema.parse(keyInput);
    const group = await db.projectGroup.findUniqueOrThrow({ where: { id: groupId }, include: { projects: { select: { id: true } } } });
    if (group.hubProjectId) throw new UserError(`${group.name} is already an umbrella.`);
    await db.$transaction(async (tx) => {
      await makeHub(
        tx,
        groupId,
        group.name,
        key,
        group.description,
        group.projects.map((p) => p.id),
        user.id,
      );
      await syncUmbrellaMembers(groupId, tx);
    });
    refresh(groupId);
    return {};
  });
}

const shortcutSchema = z.object({
  label: z.string().trim().min(1, "Give the shortcut a name").max(40),
  sub: z.string().trim().max(60).default(""),
  href: z
    .string()
    .trim()
    .max(500)
    .refine((h) => h.startsWith("/") && !h.startsWith("//"), "That isn't a Flaw Patrol page."),
  icon: z.enum(SHORTCUT_ICONS).default("link"),
});

/** The shortcuts on the umbrella's Projects-page card. Same for everyone; leads and admins change them. */
export async function setShortcuts(groupId: string, input: z.input<typeof shortcutSchema>[]) {
  return attempt(async () => {
    const { group } = await requireUmbrella(groupId, "umbrella:shortcuts");
    const list = z.array(shortcutSchema).max(MAX_SHORTCUTS, `Up to ${MAX_SHORTCUTS} shortcuts.`).parse(input);
    await db.projectGroup.update({ where: { id: group.id }, data: { shortcuts: parseShortcuts(list) } });
    refresh(group.id);
    return {};
  });
}

const MAX_PLATFORMS = 8;

/**
 * The platforms the umbrella tests on, and which shared suites each one's RC runs.
 * Changed in the Start next release box (Change suites, ⋯ Remove, ＋ Add platform) since ver_86.
 */
export async function setPlatforms(groupId: string, input: { name: string; suiteIds: string[] }[]) {
  return attempt(async () => {
    const { group, hub, user } = await requireUmbrella(groupId, "umbrella:manage");
    const list = parsePlatforms(input).slice(0, MAX_PLATFORMS);
    const names = new Set<string>();
    for (const p of list) {
      if (p.name.length > 30) throw new UserError("Keep platform names under 30 characters.");
      if (names.has(p.name.toLowerCase())) throw new UserError(`${p.name} is listed twice.`);
      names.add(p.name.toLowerCase());
    }
    const suites = await db.testSuite.findMany({ where: { projectId: hub.id }, select: { id: true } });
    const ok = new Set(suites.map((s) => s.id));
    // Cases picked from folders stay with their platform.
    const before = parsePlatforms(group.platforms);
    await db.projectGroup.update({
      where: { id: group.id },
      data: {
        platforms: list.map((p) => {
          const was = before.find((b) => b.name === p.name);
          return { name: p.name, suiteIds: p.suiteIds.filter((id) => ok.has(id)), ...(was?.caseIds ? { caseIds: was.caseIds } : {}), ...(was?.crownName ? { crownName: was.crownName } : {}) };
        }),
      },
    });
    await logActivity({ actor: user, kind: "settings", action: "Changed platforms", group, detail: list.map((p) => p.name).join(", ") });
    refresh(group.id, hub.key);
    return {};
  });
}

/** Mini game crowns: each platform's optional crown name, e.g. "Ruler of the Web". */
export async function setCrownNames(groupId: string, names: Record<string, string>) {
  return attempt(async () => {
    const { group, hub } = await requireUmbrella(groupId, "umbrella:manage");
    const platforms = parsePlatforms(group.platforms).map((p) => {
      const n = (names[p.name] ?? p.crownName ?? "").trim().slice(0, 40);
      const { crownName: _old, ...rest } = p;
      void _old;
      return n ? { ...rest, crownName: n } : rest;
    });
    await db.projectGroup.update({ where: { id: group.id }, data: { platforms } });
    await refreshCrowns(group.id).catch(() => {});
    refresh(group.id, hub.key);
    return {};
  });
}

/**
 * Rename a platform (Start next release → ⋯ → Rename platform). Its test cycles keep their
 * names and results; their platform tag follows, so the next release still finds the last one.
 */
export async function renamePlatform(groupId: string, from: string, to: string) {
  return attempt(async () => {
    const { group, hub } = await requireUmbrella(groupId, "umbrella:manage");
    const name = z.string().trim().min(1, "Give the platform a name.").max(30, "Keep platform names under 30 characters.").parse(to);
    const platforms = parsePlatforms(group.platforms);
    const i = platforms.findIndex((p) => p.name === from);
    if (i < 0) throw new UserError(`${from} isn't one of ${group.name}'s platforms.`);
    if (platforms.some((p, n) => n !== i && p.name.toLowerCase() === name.toLowerCase())) throw new UserError(`${group.name} already has a platform called ${name}.`);
    platforms[i] = { ...platforms[i], name };
    await db.$transaction([
      db.projectGroup.update({ where: { id: group.id }, data: { platforms } }),
      db.project.updateMany({ where: { groupId: group.id, platform: { equals: from, mode: "insensitive" } }, data: { platform: name } }),
    ]);
    refresh(group.id, hub.key);
    return {};
  });
}

/** A new project under the umbrella, for one platform. It gets the umbrella's team. */
export async function addUmbrellaProject(groupId: string, input: { name: string; key: string; platform: string }) {
  return attempt(async () => {
    const { user, role, group, hub } = await requireUmbrella(groupId, "cycle:create");
    notArchived(group);
    const key = keySchema.parse(input.key);
    const name = z.string().trim().min(1, "Give the test cycle a name").max(100).parse(input.name);
    const typed = z.string().trim().max(30, "Keep platform names under 30 characters.").parse(input.platform);
    if (await db.project.findUnique({ where: { key } })) throw new UserError(`Key ${key} is already used.`);
    // A platform typed here that the umbrella doesn't list yet joins its platforms,
    // so it shows in Start next release and the platform filters. A known one keeps its spelling.
    const platforms = parsePlatforms(group.platforms);
    const known = platforms.find((p) => p.name.toLowerCase() === typed.toLowerCase());
    const platform = known?.name ?? typed;
    await db.$transaction(async (tx) => {
      if (platform && !known) {
        if (platforms.length >= MAX_PLATFORMS) throw new UserError(`${group.name} already has ${MAX_PLATFORMS} platforms. Pick one of them, or remove one in Create a run → Release candidate.`);
        await tx.projectGroup.update({ where: { id: group.id }, data: { platforms: [...platforms, { name: platform, suiteIds: [] }] } });
      }
      // Whoever adds it keeps their umbrella role there (the Roles card can let testers add test cycles).
      await tx.project.create({ data: { key, name, groupId: group.id, platform, members: { create: { userId: user.id, role } } } });
      await syncUmbrellaMembers(group.id, tx);
    });
    refresh(group.id, hub.key);
    return { key };
  });
}

/**
 * + New test cycle in Pull from GitHub and Upload automation results: a place for
 * automated runs, made right in the box. No key is asked for, so one is picked, and it has no
 * release unless one is typed (then its runs count toward that release).
 */
export async function addAutomationCycle(groupId: string, input: { name: string; platform: string; release?: string }) {
  return attempt(async () => {
    const { user, role, group, hub } = await requireUmbrella(groupId, "cycle:create");
    notArchived(group);
    const name = z.string().trim().min(1, "Give the test cycle a name").max(100).parse(input.name);
    const typed = z.string().trim().max(30, "Keep platform names under 30 characters.").parse(input.platform ?? "");
    const rcName = z.string().trim().max(60, "Keep the release under 60 characters.").parse(input.release ?? "");
    const platforms = parsePlatforms(group.platforms);
    // Only the umbrella's own platforms are offered here; anything else is left blank.
    const platform = platforms.find((p) => p.name.toLowerCase() === typed.toLowerCase())?.name ?? "";
    const tries = keyCandidates(hub.key, name);
    const taken = new Set((await db.project.findMany({ where: { key: { in: tries } }, select: { key: true } })).map((p) => p.key));
    const key = tries.find((k) => !taken.has(k));
    if (!key) throw new UserError("Couldn't find a free key for that name. Try another name.");
    const made = await db.$transaction(async (tx) => {
      const p = await tx.project.create({ data: { key, name, groupId: group.id, platform, rcName, keepCurrent: true, members: { create: { userId: user.id, role } } } });
      await syncUmbrellaMembers(group.id, tx);
      return p;
    });
    await logActivity({ actor: user, kind: "settings", action: `Made test cycle ${name} for automated runs`, project: made });
    refresh(group.id, hub.key);
    return { cycle: { id: made.id, key: made.key, name: made.name, color: platformColor(platforms, platform), rcName: made.rcName, current: true } };
  });
}

/** Keep in Current: a pinned test cycle stays in Current when a newer one for its platform comes along. */
export async function setKeepCurrent(projectId: string, on: boolean) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "cycle:archive");
    if (!project.groupId) throw new UserError("This test cycle isn't in an umbrella.");
    const keep = z.boolean().parse(on);
    await db.project.update({ where: { id: projectId }, data: { keepCurrent: keep } });
    await logActivity({ actor: user, kind: "settings", action: `${keep ? "Pinned" : "Unpinned"} test cycle ${project.name} ${keep ? "to" : "from"} Current`, project });
    revalidatePath("/g", "layout");
    revalidatePath(`/p/${project.key}`, "layout");
    return {};
  });
}

/** A private project under the umbrella keeps its own team instead of getting the umbrella's. */
export async function setKeepMembersSeparate(projectId: string, on: boolean) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "project:separate");
    if (!project.groupId) throw new UserError("This test cycle isn't in an umbrella.");
    await db.$transaction(async (tx) => {
      await tx.project.update({ where: { id: projectId }, data: { keepMembersSeparate: on } });
      // Keep whoever switched it on, so the project isn't left without an admin.
      if (on) await tx.projectMember.updateMany({ where: { projectId, role: "ADMIN" }, data: { fromUmbrella: false } });
      await syncUmbrellaMembers(project.groupId!, tx);
    });
    await logActivity({ actor: user, kind: "people", action: `Turned ${on ? "on" : "off"} Keep members separate`, project });
    revalidatePath(`/p/${project.key}`, "layout");
    revalidatePath(`/g/${project.groupId}`, "layout");
    return {};
  });
}

/** "RC23" from "RC22", "RC 9" from "RC 8"; null when there's no number to bump. */
function nextRc(name: string) {
  const m = name.match(/^(.*?)(\d+)(\D*)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : null;
}

/** A free project key like OKOUNT23 (umbrella, platform's first letter and consonants, RC number). */
async function freeKey(tx: Prisma.TransactionClient, hubKey: string, platform: string, rc: string) {
  const letters = platform.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Unity → UNT, Unreal → UNR, Web → WB: different platforms rarely clash.
  const short = (letters[0] ?? "P") + letters.slice(1).replace(/[AEIOU]/g, "").slice(0, 2);
  const digits = rc.replace(/\D/g, "");
  const base = `${hubKey.slice(0, 4)}${short}${digits}`.slice(0, 10);
  for (let n = 0; n < 100; n++) {
    const key = n ? `${base.slice(0, 10 - String(n + 1).length)}${n + 1}` : base;
    if (!(await tx.project.findUnique({ where: { key } }))) return key;
  }
  throw new UserError("Couldn't find a free test cycle key. Try a shorter release name.");
}

/** What Start next release would do, for its box: the last release per platform, its suites, assignments and open bugs. */
export async function rcPlan(groupId: string) {
  const { group, hub } = await requireUmbrella(groupId, "umbrella:rc");
  const platforms = parsePlatforms(group.platforms);
  const suites = await db.testSuite.findMany({
    where: { projectId: hub.id, archived: false },
    select: { id: true, name: true, cases: { where: { testCase: { archived: false } }, select: { caseId: true } } },
  });
  const projects = await db.project.findMany({ where: { groupId, archivedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, platform: true, rcName: true } });
  // The library as a folder tree, for Choose from folders….
  const [folders, cases, hubMembers] = await Promise.all([
    db.folder.findMany({ where: { projectId: hub.id }, select: { id: true, parentId: true, name: true } }),
    db.testCase.findMany({ where: { projectId: hub.id, archived: false }, orderBy: { number: "asc" }, select: { id: true, number: true, title: true, folderId: true, type: true } }),
    db.projectMember.findMany({ where: { projectId: hub.id }, select: { userId: true } }),
  ]);
  const inLibrary = new Set(cases.map((c) => c.id));
  const team = new Set(hubMembers.map((m) => m.userId));
  const rows = await Promise.all(
    platforms.map(async (p) => {
      const mine = suites.filter((s) => p.suiteIds.includes(s.id));
      const prev = projects.find((x) => x.platform.toLowerCase() === p.name.toLowerCase());
      const testers = prev
        ? await db.runEntry.findMany({ where: { run: { projectId: prev.id, bugBash: { is: null } }, assigneeId: { not: null } }, distinct: ["assigneeId"], select: { assigneeId: true } })
        : [];
      const names = testers.length ? await db.user.findMany({ where: { id: { in: testers.map((t) => t.assigneeId!) } }, select: { name: true, email: true } }) : [];
      const bugs = prev ? await openBugCaseIds([prev.id]) : { keys: [], caseIds: [] };
      // Runs still open in the last release, which Start next release can close.
      const openRuns = prev ? await db.testRun.count({ where: { projectId: prev.id, state: "ACTIVE" } }) : 0;
      // Every library case the last release ran on this platform, and who had each one (latest wins), case by case.
      const entries = prev
        ? // Bug bash runs are kept out of releases, so "Same cases as" never counts their charters.
          await db.runEntry.findMany({ where: { run: { projectId: prev.id, automated: false, bugBash: { is: null } } }, orderBy: [{ run: { createdAt: "asc" } }, { position: "asc" }], select: { caseId: true, assigneeId: true } })
        : [];
      const lastCaseIds = [...new Set(entries.map((e) => e.caseId))].filter((id) => inLibrary.has(id));
      // The suites the last test cycle's runs actually used, by the run's suite or,
      // for a run of picked cases, the suite with exactly those cases.
      const prevRuns = prev ? await db.testRun.findMany({ where: { projectId: prev.id, automated: false, bugBash: { is: null } }, select: { suiteId: true, entries: { select: { caseId: true } } } }) : [];
      const sets = suites.map((s) => ({ id: s.id, caseIds: s.cases.map((c) => c.caseId) }));
      const lastSuiteIds = [...new Set(prevRuns.map((r) => (r.suiteId && suites.some((s) => s.id === r.suiteId) ? r.suiteId : suiteForCases(sets, r.entries.map((e) => e.caseId))?.id)).filter((id): id is string => !!id))];
      const assignedIds = new Map<string, string>();
      for (const e of entries) if (e.assigneeId && team.has(e.assigneeId)) assignedIds.set(e.caseId, e.assigneeId);
      const people = assignedIds.size ? await db.user.findMany({ where: { id: { in: [...new Set(assignedIds.values())] } }, select: { id: true, name: true, email: true } }) : [];
      const nameOf = new Map(people.map((u) => [u.id, u.name ?? u.email.split("@")[0]]));
      return {
        lastCaseIds,
        lastSuiteIds,
        assign: Object.fromEntries([...assignedIds].map(([caseId, userId]) => [caseId, nameOf.get(userId) ?? "Someone"])),
        bugCaseIds: bugs.caseIds.filter((id) => inLibrary.has(id)),
        remembered: (p.caseIds ?? []).filter((id) => inLibrary.has(id)),
        name: p.name,
        // Colored here since ver_120, now that the box fetches this itself.
        color: platformColor(platforms, p.name),
        suiteIds: mine.map((s) => s.id),
        suites: mine.map((s) => s.name),
        runs: mine.length,
        cases: new Set(mine.flatMap((s) => s.cases.map((c) => c.caseId))).size,
        // Test cycles made with Add test cycle have no release name, so they go by their own name.
        prev: prev ? { name: prev.name, rc: prev.rcName || prev.name } : null,
        testers: names.map((n) => n.name ?? n.email.split("@")[0]),
        openBugs: bugs.keys,
        openRuns,
      };
    }),
  );
  // The newest test cycle's release, or its name when it has none ("Demo RC 1" suggests "Demo RC 2").
  const lastRc = projects.find((p) => p.rcName)?.rcName || projects[0]?.name || "";
  return {
    umbrella: group.name,
    hubKey: hub.key,
    platforms: rows,
    // Every shared suite, so the RC box can add a platform or pick its suite on the spot.
    allSuites: suites.map((s) => ({ id: s.id, name: s.name, cases: s.cases.length, caseIds: s.cases.map((c) => c.caseId) })),
    library: { folders, cases: cases.map((c) => ({ id: c.id, key: `${hub.key}-${c.number}`, title: c.title, folderId: c.folderId })) },
    // Automated-only cases: suites' runs leave them out unless "Also include" is ticked.
    autoCaseIds: cases.filter((c) => c.type === "AUTOMATED").map((c) => c.id),
    lastRc,
    // Releases that already have test cycles: typing one shows "Create a run instead".
    releases: projects.filter((p) => p.rcName.trim()).map((p) => ({ rc: p.rcName.trim(), platform: p.platform.trim() })),
    // Offered as "Use Demo RC 2" next to the empty Release box, never filled in.
    suggested: (lastRc && nextRc(lastRc)) || "",
    runFields: parseRunFields(group.runFields),
  };
}

/** Cases with open bugs filed from these projects' runs, and how many distinct bugs. */
async function openBugCaseIds(projectIds: string[]) {
  const bugs = await db.defect.findMany({
    where: { projectId: { in: projectIds }, ...OPEN_BUG },
    select: { id: true, externalKey: true, links: { select: { result: { select: { caseId: true } } } } },
  });
  return { keys: [...new Set(bugs.map((b) => b.externalKey ?? b.id))], caseIds: [...new Set(bugs.flatMap((b) => b.links.map((l) => l.result.caseId)))] };
}

const rcSchema = z.object({
  rc: z.string().trim().min(1, "Name the release you're testing").max(30),
  platforms: z.array(z.string()).min(1, "Pick at least one platform."),
  // Nothing carries over unless it's ticked.
  carryAssignments: z.boolean().default(false),
  recheckBugs: z.boolean().default(false),
  /** The umbrella's run fields for every run made, by field id. "csp" fills cspVersion. */
  fields: z.record(z.string(), z.string().max(200)).default({}),
  /** Close the last release's open runs on these platforms. */
  closeOld: z.boolean().default(false),
  /** "Also include the automated cases": off, suites' automated-only cases stay out of the runs. */
  withAutomated: z.boolean().default(false),
  /**
   * What each platform runs this release: suites from the library, nothing yet (a test cycle with no
   * runs), or a new empty suite made now. A platform left out runs the suites it's set to.
   */
  choices: z
    .record(
      z.string(),
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("suites"), ids: z.array(z.string()).min(1, "Pick at least one suite.") }),
        z.object({ kind: z.literal("empty") }),
        /** Cases picked from folders, or the same cases as last release. */
        z.object({ kind: z.literal("cases"), ids: z.array(z.string()).min(1, "Pick at least one case.").max(5000) }),
        z.object({ kind: z.literal("newsuite"), name: z.string().trim().min(1, "Name the new suite.").max(100) }),
      ]),
    )
    .default({}),
});

/**
 * Start the next release: one new project per platform, each with a run for every
 * shared suite that platform uses. Testers can carry over from the last release, and
 * cases with bugs still open from it go first so they're re-checked early.
 */
export async function startNextRc(groupId: string, input: z.input<typeof rcSchema>) {
  return attempt(async () => {
    const { user, role, group, hub } = await requireUmbrella(groupId, "umbrella:rc");
    notArchived(group);
    const data = rcSchema.parse(input);
    const typed = await fieldsOrFail(hub.id, data.fields, { defs: parseRunFields(group.runFields) });
    const all = parsePlatforms(group.platforms);
    const chosen = all.filter((p) => data.platforms.includes(p.name));
    if (!chosen.length) throw new UserError("Pick at least one platform.");
    const unset = chosen.find((p) => !data.choices[p.name] && p.suiteIds.length === 0);
    if (unset) throw new UserError(`Pick test cases for ${unset.name}.`);
    // New suites are made empty in the library; their cases are added there, then a run started.
    const hubSuites = new Set((await db.testSuite.findMany({ where: { projectId: hub.id, archived: false }, select: { id: true } })).map((x) => x.id));
    const platforms: { name: string; suiteIds: string[]; caseIds?: string[] }[] = [];
    for (const p of chosen) {
      const c = data.choices[p.name];
      if (!c) platforms.push({ name: p.name, suiteIds: p.suiteIds });
      else if (c.kind === "empty") platforms.push({ name: p.name, suiteIds: [] });
      else if (c.kind === "cases") {
        const live = new Set((await db.testCase.findMany({ where: { id: { in: c.ids }, projectId: hub.id, archived: false }, select: { id: true } })).map((x) => x.id));
        const ids = c.ids.filter((id) => live.has(id));
        if (!ids.length) throw new UserError(`The cases picked for ${p.name} are gone. Reload and pick again.`);
        platforms.push({ name: p.name, suiteIds: [], caseIds: ids });
      }
      else if (c.kind === "suites") {
        const ids = c.ids.filter((id) => hubSuites.has(id));
        if (!ids.length) throw new UserError(`The suites picked for ${p.name} are gone. Reload and pick again.`);
        platforms.push({ name: p.name, suiteIds: ids });
      } else {
        if (!can(role, "suite:manage")) throw new UserError("You can't make suites here.");
        const suite = await db.$transaction(async (tx) => {
          const made = await tx.testSuite.create({ data: { projectId: hub.id, name: c.name, description: `Made for ${p.name} in ${data.rc}` } });
          await tx.suiteVersion.create({ data: { suiteId: made.id, version: 1, name: c.name, caseIds: [], changeNote: "Created", authorId: user.id, authorName: user.name ?? user.email } });
          return made;
        });
        platforms.push({ name: p.name, suiteIds: [suite.id] });
      }
    }
    // The suites or cases picked are remembered for each platform's next release, as Change suites did (admins only).
    if (can(role, "umbrella:manage")) {
      const changed = all.map((p) => {
        const c = data.choices[p.name];
        const now = platforms.find((x) => x.name === p.name);
        if (!c || c.kind === "empty" || !now) return p;
        const crown = p.crownName ? { crownName: p.crownName } : {};
        return now.caseIds ? { name: p.name, suiteIds: [], caseIds: now.caseIds, ...crown } : { name: p.name, suiteIds: now.suiteIds, ...crown };
      });
      await db.projectGroup.update({ where: { id: group.id }, data: { platforms: changed } });
    }
    const hubMembers = new Set((await db.projectMember.findMany({ where: { projectId: hub.id }, select: { userId: true } })).map((m) => m.userId));
    const made: { key: string; name: string; runs: number }[] = [];

    for (const p of platforms) {
      const name = `${group.name} ${p.name} ${data.rc}`;
      if (await db.project.findFirst({ where: { groupId, name: { equals: name, mode: "insensitive" } } })) throw new UserError(`${name} already exists.`);
      const prev = await db.project.findFirst({
        where: { groupId, archivedAt: null, platform: { equals: p.name, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, rcName: true },
      });
      // Who tested each case last release (their latest assignment wins).
      const assigned = new Map<string, string>();
      if (prev && data.carryAssignments) {
        const rows = await db.runEntry.findMany({ where: { run: { projectId: prev.id, bugBash: { is: null } }, assigneeId: { not: null } }, orderBy: { run: { createdAt: "asc" } }, select: { caseId: true, assigneeId: true } });
        for (const r of rows) if (hubMembers.has(r.assigneeId!)) assigned.set(r.caseId, r.assigneeId!);
      }
      const recheck = new Set(prev && data.recheckBugs ? (await openBugCaseIds([prev.id])).caseIds : []);
      // Quietly, like Close run on each: they can be reopened from the run's More menu.
      if (prev && data.closeOld) await db.testRun.updateMany({ where: { projectId: prev.id, state: "ACTIVE" }, data: { state: "COMPLETED", completedAt: new Date() } });
      const suites = await db.testSuite.findMany({
        where: { id: { in: p.suiteIds }, projectId: hub.id, archived: false },
        // Automation already runs automated-only cases: left out unless asked for.
        include: { cases: { where: data.withAutomated ? {} : { testCase: { type: { not: "AUTOMATED" } } }, orderBy: { position: "asc" } } },
      });
      const order = new Map(p.suiteIds.map((id, i) => [id, i]));
      suites.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

      // A test cycle made with no runs keeps the carry-over for its first run.
      const later = !p.suiteIds.length && !p.caseIds;
      const carry: CarryOver | null = later && prev && (assigned.size || recheck.size) ? { from: prev.rcName, assigned: Object.fromEntries(assigned), recheck: [...recheck] } : null;
      const project = await db.$transaction(
        async (tx) => {
          const key = await freeKey(tx, hub.key, p.name, data.rc);
          const proj = await tx.project.create({
            data: { key, name, groupId, platform: p.name, rcName: data.rc, description: `${p.name} · ${data.rc}`, ...(carry ? { carryOver: carry } : {}) },
          });
          await syncUmbrellaMembers(groupId, tx);
          if (!user.isAdmin && !hubMembers.has(user.id)) await tx.projectMember.create({ data: { projectId: proj.id, userId: user.id, role: "ADMIN" } });
          let runs = 0;
          // Cases picked from folders (or the same as last release) make one run.
          const sets: { suiteId: string | null; suiteVersion: number | null; name: string; ids: string[] }[] = p.caseIds
            ? [{ suiteId: null, suiteVersion: null, name: `${p.name} ${data.rc}`, ids: p.caseIds }]
            : suites.map((s) => ({ suiteId: s.id, suiteVersion: s.currentVersion, name: s.name, ids: s.cases.map((c) => c.caseId) }));
          for (const s of sets) {
            const ids = s.ids;
            // Re-check first: cases whose bug is still open, in suite order, then the rest.
            const caseIds = [...ids.filter((id) => recheck.has(id)), ...ids.filter((id) => !recheck.has(id))];
            const entries = await buildEntries(tx, [hub.id], caseIds, null);
            if (!entries.length) continue;
            runs++;
            await tx.testRun.create({
              data: {
                projectId: proj.id,
                number: runs,
                suiteId: s.suiteId,
                suiteVersion: s.suiteVersion,
                name: s.name,
                release: data.rc,
                kind: "rc",
                withAutomated: entries.some((e) => e.kind === "AUTOMATED"),
                cspVersion: typed.cspVersion ?? "",
                fields: typed.fields,
                description: recheck.size ? "Cases with bugs still open from the last run are first, so they get re-checked early." : "",
                createdById: user.id,
                createdBy: user.name ?? user.email,
                entries: { create: entries.map((e, i) => ({ ...e, position: i, assigneeId: assigned.get(e.caseId) ?? null })) },
              },
            });
          }
          await tx.project.update({ where: { id: proj.id }, data: { runSeq: runs } });
          return { key, name, runs };
        },
        { timeout: 120_000 },
      );
      made.push(project);
    }
    await logActivity({ actor: user, kind: "run", action: `Started release ${data.rc}`, group, detail: made.map((m) => m.name).join(", ") });
    refresh(groupId, hub.key);
    return { made };
  });
}

/**
 * Move a project's cases, suites and shared steps up into the umbrella's shared
 * library. A case whose title the library already has isn't copied: the suites
 * switch to the library's case and the project's copy is archived. Runs keep what they ran.
 */
export async function moveCasesIntoUmbrella(groupId: string, fromProjectId: string) {
  return attempt(async () => {
    const { group, hub } = await requireUmbrella(groupId, "library:move");
    const from = await db.project.findUnique({ where: { id: fromProjectId } });
    if (!from || from.groupId !== groupId) throw new UserError(`That test cycle isn't in ${group.name}.`);
    await requireProjectAction(from.id, "library:move");
    const result = await db.$transaction(
      async (tx) => {
        const cases = await tx.testCase.findMany({ where: { projectId: from.id, archived: false }, include: { persona: true }, orderBy: { number: "asc" } });
        const library = await tx.testCase.findMany({ where: { projectId: hub.id, archived: false }, select: { id: true, title: true } });
        const byTitle = new Map(library.map((c) => [c.title.trim().toLowerCase(), c.id]));
        const fromFolders = await tx.folder.findMany({ where: { projectId: from.id }, select: { id: true, parentId: true, name: true } });
        const hubFolders = await tx.folder.findMany({ where: { projectId: hub.id }, select: { id: true, parentId: true, name: true } });
        // Rebuild the folder path in the library, reusing folders with the same name.
        const folderFor = async (folderId: string | null) => {
          if (!folderId) return null;
          let parent: string | null = null;
          for (const name of pathOf(fromFolders, folderId)) {
            let f = hubFolders.find((x) => x.parentId === parent && x.name === name);
            if (!f) {
              f = await tx.folder.create({ data: { projectId: hub.id, parentId: parent, name }, select: { id: true, parentId: true, name: true } });
              hubFolders.push(f);
            }
            parent = f.id;
          }
          return parent;
        };
        const personaFor = async (p: { name: string; emoji: string; description: string } | null) => {
          if (!p) return null;
          const found = await tx.persona.findUnique({ where: { projectId_name: { projectId: hub.id, name: p.name } } });
          return (found ?? (await tx.persona.create({ data: { projectId: hub.id, name: p.name, emoji: p.emoji, description: p.description } }))).id;
        };
        let moved = 0;
        let matched = 0;
        let seq = (await tx.project.findUniqueOrThrow({ where: { id: hub.id }, select: { caseSeq: true } })).caseSeq;
        const sharedIds = new Set<string>();
        for (const c of cases) {
          const twin = byTitle.get(c.title.trim().toLowerCase());
          if (twin) {
            // Point this project's suites at the library's case, then archive the copy.
            const uses = await tx.suiteCase.findMany({ where: { caseId: c.id } });
            for (const u of uses) {
              const has = await tx.suiteCase.findUnique({ where: { suiteId_caseId: { suiteId: u.suiteId, caseId: twin } } });
              await tx.suiteCase.delete({ where: { suiteId_caseId: { suiteId: u.suiteId, caseId: c.id } } });
              if (!has) await tx.suiteCase.create({ data: { suiteId: u.suiteId, caseId: twin, position: u.position } });
            }
            await tx.testCase.update({ where: { id: c.id }, data: { archived: true } });
            matched++;
            continue;
          }
          seq++;
          await tx.testCase.update({
            where: { id: c.id },
            data: { projectId: hub.id, number: seq, folderId: await folderFor(c.folderId), personaId: await personaFor(c.persona) },
          });
          byTitle.set(c.title.trim().toLowerCase(), c.id);
          for (const u of await tx.caseSharedStep.findMany({ where: { caseId: c.id }, select: { sharedStepId: true } })) sharedIds.add(u.sharedStepId);
          moved++;
        }
        await tx.project.update({ where: { id: hub.id }, data: { caseSeq: seq } });
        // Shared steps the moved cases use come along, so the library can edit them.
        if (sharedIds.size) await tx.sharedStep.updateMany({ where: { id: { in: [...sharedIds] }, projectId: from.id }, data: { projectId: hub.id } });
        // So do its suites, so each platform can pick them for the next release.
        const suites = (await tx.testSuite.updateMany({ where: { projectId: from.id }, data: { projectId: hub.id } })).count;
        return { moved, matched, suites };
      },
      { timeout: 120_000 },
    );
    refresh(groupId, hub.key);
    revalidatePath(`/p/${from.key}`, "layout");
    return result;
  });
}

/**
 * Archive an umbrella and every project under it that isn't archived yet, or
 * restore it. Restoring brings back only the projects that went with it, so RCs
 * archived on their own before stay archived. Admins only. Nothing is deleted.
 */
export async function setUmbrellaArchived(groupId: string, archived: boolean) {
  return attempt(async () => {
    const { group, hub, user } = await requireUmbrella(groupId, "umbrella:archive");
    if (archived === !!group.archivedAt) return {};
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.projectGroup.update({ where: { id: groupId }, data: { archivedAt: archived ? now : null } });
      const projects = { OR: [{ groupId }, { id: hub.id }] };
      if (archived) await tx.project.updateMany({ where: { ...projects, archivedAt: null }, data: { archivedAt: now, archivedWithUmbrella: true } });
      else await tx.project.updateMany({ where: { ...projects, archivedWithUmbrella: true }, data: { archivedAt: null, archivedWithUmbrella: false } });
    });
    await logActivity({ actor: user, kind: "delete", action: `${archived ? "Archived" : "Restored"} umbrella ${group.name}`, group });
    refresh(groupId, hub.key);
    revalidatePath("/p", "layout");
    return {};
  });
}

const runFieldSchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1, "Name the field.").max(40, "Keep the field name under 40 characters."),
  type: z.enum(["text", "list"]),
  choices: z.array(z.string().trim().min(1).max(60)).max(30, "A list can have up to 30 choices.").default([]),
  required: z.boolean().default(false),
  rc: z.boolean().default(false),
  jira: z.boolean().default(false),
});
const BUILT_IN = ["release", "release candidate", "rc", "build", "environment", "name", "notes"];

/** Run fields: save the umbrella's whole list. Old runs keep the values they have. */
export async function setRunFields(groupId: string, input: z.input<typeof runFieldSchema>[]) {
  return attempt(async () => {
    const { group, hub, user } = await requireUmbrella(groupId, "umbrella:fields");
    notArchived(group);
    const list = z.array(runFieldSchema).max(MAX_RUN_FIELDS, `${MAX_RUN_FIELDS} fields is the most an umbrella can have.`).parse(input);
    const seen = new Set<string>();
    const fields: RunField[] = list.map((f) => {
      const low = f.name.toLowerCase();
      if (BUILT_IN.includes(low)) throw new UserError(`${f.name} is already built in. Pick another name.`);
      if (seen.has(low)) throw new UserError(`There's already a field called ${f.name}.`);
      seen.add(low);
      const choices = [...new Set(f.choices)];
      if (f.type === "list" && !choices.length) throw new UserError(`Add the choices for ${f.name}, separated by commas.`);
      const id = f.id || `${low.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "field"}-${Math.random().toString(36).slice(2, 6)}`;
      return { id, name: f.name, type: f.type, choices: f.type === "list" ? choices : [], required: f.required, rc: f.rc, jira: f.jira };
    });
    await db.projectGroup.update({ where: { id: group.id }, data: { runFields: fields } });
    await logActivity({ actor: user, kind: "settings", action: "Changed run fields", group, detail: fields.map((f) => f.name).join(", ") || "None" });
    refresh(group.id, hub.key);
    return { fields };
  });
}
