"use server";

import { libraryCaseNews } from "@/lib/case-news-data";
import { tagColorsFor } from "@/lib/tag-data";
import { CSP_FIELD, parseRunFields } from "@/lib/run-fields";
import { kindIdFor, parseRunKinds } from "@/lib/run-kinds";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireProjectAction, requireUser, roleRulesFor } from "@/lib/session";
import { projectMembers, suitePickerData } from "@/lib/suite-data";
import { libraryProjectIds, loadUmbrella, platformColor, umbrellaOf } from "@/lib/umbrella";
import { attempt, UserError } from "./result";
import { addUmbrellaProject } from "./umbrella";
import { createRun } from "./runs";

// The Start a run box (ver_76): pick what to run from the library (all of it, a
// suite, or ticked cases), then the test cycles to run it in, one run in each.

export type RunBoxScope = { projectKey: string } | { groupId: string };

export type RunBoxCycle = { id: string; key: string; name: string; color: string; current: boolean; rcName: string; members: { id: string; name: string }[] };

/** Everything the box offers: the test cycles the viewer can start runs in, and the library to pick from. */
export async function runBoxOptions(scope: RunBoxScope) {
  return attempt(async () => {
    const user = await requireUser();
    let here: { id: string; key: string; name: string; groupId: string | null; rcName: string } | null = null;
    let groupId: string | null = null;
    if ("projectKey" in scope) {
      const p = await db.project.findUnique({ where: { key: scope.projectKey.toUpperCase() }, select: { id: true, key: true, name: true, groupId: true, rcName: true } });
      if (!p) throw new UserError("Test cycle not found.");
      const u = await umbrellaOf(p);
      if (u) groupId = u.group.id;
      // An umbrella's hub is the umbrella itself: its runs go in the test cycles under it.
      if (!u?.isHub) here = p;
    } else groupId = scope.groupId;

    const umbrella = groupId ? await loadUmbrella(groupId, user) : null;
    let cycles: { id: string; key: string; name: string; platform: string; rcName: string; current: boolean }[];
    let library: { id: string; groupId: string | null };
    if (umbrella) {
      const current = new Set(umbrella.current.map((p) => p.id));
      cycles = [...umbrella.current, ...umbrella.older.filter((p) => !p.archivedAt)].map((p) => ({ id: p.id, key: p.key, name: p.name, platform: p.platform, rcName: p.rcName, current: current.has(p.id) }));
      // Inside a test cycle its own old cases can be picked too, next to the Case library's.
      library = here ? { id: here.id, groupId: here.groupId } : { id: umbrella.hub.id, groupId: null };
    } else if (here) {
      cycles = [{ id: here.id, key: here.key, name: here.name, platform: "", rcName: here.rcName, current: true }];
      library = { id: here.id, groupId: null };
    } else throw new UserError("This umbrella isn't available.");

    // An umbrella with no test cycles yet has nowhere to run: step 2 of the box offers to
    // make the first one (ver_82), for whoever the Roles card lets add a test cycle.
    // (Non-admins only see their own test cycles here, so count them all.)
    const empty = !!umbrella && !cycles.length && !(await db.project.count({ where: { groupId: umbrella.group.id, archivedAt: null } }));
    // Since ver_95 step 2 always ends with "+ New test cycle", made when you press Start.
    const newCycle = umbrella ? { empty, canCreate: can(umbrella.who, "cycle:create") && !umbrella.group.archivedAt, platforms: umbrella.platforms.map((p) => p.name) } : null;

    // Only test cycles the viewer can start runs in, under the umbrella's (or this test cycle's) Roles card.
    const rules = umbrella ? umbrella.who.rules : here ? await roleRulesFor(here) : null;
    const roles = await db.projectMember.findMany({ where: { userId: user.id, projectId: { in: cycles.map((c) => c.id) } }, select: { projectId: true, role: true } });
    const roleOf = new Map<string, Role>(roles.map((r) => [r.projectId, r.role]));
    cycles = cycles.filter((c) => can({ role: user.isAdmin ? "ADMIN" : (roleOf.get(c.id) ?? null), rules }, "run:create"));
    if (!cycles.length && !empty && !newCycle?.canCreate) throw new UserError(umbrella ? `You can't start runs in any ${umbrella.group.name} test cycle yet. Ask an admin to add you to one.` : "You can't start runs here.");

    const libIds = await libraryProjectIds(library);
    const [picker, suites, members, allCount] = await Promise.all([
      suitePickerData(library),
      db.testSuite.findMany({
        where: { projectId: { in: libIds }, archived: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true, projectId: true, _count: { select: { cases: { where: { testCase: { archived: false } } } } } },
      }),
      Promise.all(cycles.map((c) => projectMembers(c.id))),
      // "Whole Case library": the umbrella's library, or a lone project's own cases.
      db.testCase.count({ where: { projectId: umbrella ? umbrella.hub.id : library.id, archived: false } }),
    ]);
    const colorOf = (platform: string) => (umbrella ? platformColor(umbrella.platforms, platform) : "#94a3b8");
    // Run kinds (ver_95): what kind of run it is, asked first in an umbrella.
    const kinds = umbrella ? parseRunKinds(umbrella.group.runKinds).filter((k) => !k.hidden) : [];
    return {
      umbrella: umbrella ? { id: umbrella.group.id, name: umbrella.group.name, hubKey: umbrella.hub.key } : null,
      // The test cycle the box was opened from, ticked for you (ver_85).
      hereId: here?.id ?? null,
      newCycle,
      kinds: kinds.map((k) => ({ id: k.id, name: k.name, suiteId: k.suiteId, builtIn: k.builtIn })),
      // Release candidate opens the release box, which needs the umbrella:rc permission.
      canRc: !!umbrella && can(umbrella.who, "umbrella:rc") && !umbrella.group.archivedAt,
      // The latest release-candidate test cycle, for the kind's line ("carries over from Demo RC 1").
      lastCycle: umbrella ? (umbrella.current.find((p) => p.rcName)?.rcName || umbrella.current[0]?.name || "") : "",
      meId: user.id,
      // Run fields (ver_89): the umbrella's, or CSP version for a test cycle outside one.
      runFields: umbrella ? parseRunFields(umbrella.group.runFields) : [CSP_FIELD],
      cycles: cycles.map((c, i): RunBoxCycle => ({ id: c.id, key: c.key, name: c.name, color: colorOf(c.platform), current: c.current, rcName: c.rcName, members: members[i].map((m) => ({ id: m.id, name: m.name })) })),
      allCount,
      tagColors: await tagColorsFor(library.id),
      suites: suites.map((s) => ({ id: s.id, name: s.name, cases: s._count.cases, ownerId: s.projectId, shared: !!umbrella && s.projectId !== here?.id })),
      ...picker,
      // New and Updated cases (ver_96), by case id.
      news: await libraryCaseNews(picker.cases.map((c) => c.id)),
    };
  });
}
export type RunBoxOptions = Extract<Awaited<ReturnType<typeof runBoxOptions>>, { ok: true }>;

const startSchema = z.object({
  cycleIds: z.array(z.string()).min(1, "Tick a test cycle to run it in.").max(12),
  what: z.enum(["all", "suite", "cases"]),
  suiteId: z.string().optional(),
  caseIds: z.array(z.string()).max(5000).optional(),
  name: z.string().trim().min(1, "Give the run a name").max(200),
  release: z.string().trim().max(200).default(""),
  build: z.string().trim().max(200).default(""),
  cspVersion: z.string().trim().max(200).default(""),
  environment: z.string().trim().max(200).default(""),
  description: z.string().max(5000).default(""),
  assigneeId: z.string().nullable().default(null),
  fields: z.record(z.string(), z.string().max(200)).default({}),
  /** "Use each test cycle's own" release (ver_99): a blank release otherwise stays blank. */
  cycleRelease: z.boolean().default(false),
  /** The run kind picked first (ver_95). */
  runKind: z.string().trim().max(40).default(""),
});

/** Start one run in each ticked test cycle. Each test cycle's own release only when asked for (ver_99). */
export async function startRuns(input: z.input<typeof startSchema>) {
  return attempt(async () => {
    const data = startSchema.parse(input);
    if (data.what === "suite" && !data.suiteId) throw new UserError("Pick a suite to run.");
    if (data.what === "cases" && !data.caseIds?.length) throw new UserError("Tick at least one case to run.");
    const started: { key: string; number: number; name: string }[] = [];
    for (const cycleId of [...new Set(data.cycleIds)]) {
      const { project } = await requireProjectAction(cycleId, "run:create");
      let source: Parameters<typeof createRun>[1];
      if (data.what === "suite") source = { kind: "suite", suiteId: data.suiteId! };
      else {
        const u = await umbrellaOf(project);
        // The whole library is the umbrella's Case library; outside an umbrella, the project's own cases.
        const ids = data.what === "all" ? (u && !u.isHub ? [u.hub.id] : [project.id]) : await libraryProjectIds(project);
        const cases = await db.testCase.findMany({
          where: { projectId: { in: ids }, archived: false, ...(data.what === "cases" ? { id: { in: data.caseIds } } : {}) },
          orderBy: [{ projectId: "asc" }, { number: "asc" }],
          select: { id: true },
        });
        const order = data.what === "cases" ? new Map(data.caseIds!.map((id, i) => [id, i])) : null;
        const caseIds = cases.map((c) => c.id).sort((a, b) => (order ? order.get(a)! - order.get(b)! : 0));
        if (!caseIds.length) throw new UserError(started.length ? stopped(started, project.name, "it has none of these cases") : `${project.name} has none of these cases to run.`);
        source = { kind: "cases", caseIds };
      }
      // Cases go to the chosen tester only where they're on the team.
      const member = data.assigneeId ? await db.projectMember.findUnique({ where: { projectId_userId: { projectId: cycleId, userId: data.assigneeId } } }) : null;
      const res = await createRun(cycleId, source, {
        name: data.name,
        description: data.description,
        build: data.build,
        cspVersion: data.cspVersion,
        fields: data.fields,
        environment: data.environment,
        release: data.release || (data.cycleRelease ? project.rcName : ""),
        runKind: data.runKind,
        assigneeId: member ? data.assigneeId : null,
      });
      if (!res.ok) throw new UserError(started.length ? stopped(started, project.name, res.error) : `${project.name}: ${res.error}`);
      started.push({ key: project.key, number: res.number, name: project.name });
    }
    return { runs: started };
  });
}

function stopped(started: { name: string }[], name: string, why: string) {
  return `Started runs in ${started.map((s) => s.name).join(", ")}, but not in ${name}: ${why}`;
}

/** A short free key from a test cycle's name: "RC 1 Web" → RC1WEB, then RC1WEB2… if taken. */
async function keyFromName(name: string) {
  let base = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (!/^[A-Z]/.test(base)) base = `C${base}`.slice(0, 8);
  if (base.length < 2) base = `${base}TC`.slice(0, 8);
  for (let i = 1; i < 100; i++) {
    const key = i === 1 ? base : `${base}${i}`;
    if (!(await db.project.findUnique({ where: { key }, select: { id: true } }))) return key;
  }
  throw new UserError("Couldn't make a key from that name. Try a shorter, different name.");
}

/** Step 2 of Start a run in an umbrella with no test cycles: make the first one right there. */
export async function createCycleFromRunBox(groupId: string, input: { name: string; platform: string }) {
  return attempt(async () => {
    const name = z.string().trim().min(1, "Give the test cycle a name").max(100).parse(input.name);
    const platform = z.string().trim().max(30).parse(input.platform);
    const res = await addUmbrellaProject(groupId, { name, platform, key: await keyFromName(name) });
    if (!res.ok) throw new UserError(res.error);
    const user = await requireUser();
    const [p, umbrella] = await Promise.all([db.project.findUniqueOrThrow({ where: { key: res.key } }), loadUmbrella(groupId, user)]);
    const members = await projectMembers(p.id);
    const cycle: RunBoxCycle = { id: p.id, key: p.key, name: p.name, color: umbrella ? platformColor(umbrella.platforms, p.platform) : "#94a3b8", current: true, rcName: p.rcName, members: members.map((m) => ({ id: m.id, name: m.name })) };
    return { cycle };
  });
}

const kindSchema = z.object({
  name: z.string().trim().min(1, "Name the kind of run.").max(60, "Keep the name under 60 characters."),
  suiteId: z.string().nullable().default(null),
});

/** "+ New kind…" in Start a run (ver_95): added to the umbrella and used at once. Anyone who can start runs can add one. */
export async function addRunKind(groupId: string, input: z.input<typeof kindSchema>) {
  return attempt(async () => {
    const data = kindSchema.parse(input);
    const user = await requireUser();
    const umbrella = await loadUmbrella(groupId, user);
    if (!umbrella || !can(umbrella.who, "run:create")) throw new UserError("You can't start runs here.");
    const kinds = parseRunKinds(umbrella.group.runKinds);
    if (kinds.some((k) => k.name.toLowerCase() === data.name.toLowerCase())) throw new UserError(`There's already a kind called ${data.name}.`);
    const suite = data.suiteId ? await db.testSuite.findFirst({ where: { id: data.suiteId, projectId: umbrella.hub.id }, select: { id: true } }) : null;
    const id = kindIdFor(data.name, kinds.map((k) => k.id));
    const stored = storedKinds(kinds);
    stored.push({ id, name: data.name, suiteId: suite?.id ?? null, hidden: false });
    await db.projectGroup.update({ where: { id: groupId }, data: { runKinds: stored } });
    await logActivity({ actor: user, kind: "settings", action: `Added the run kind ${data.name}`, group: umbrella.group });
    revalidatePath(`/g/${groupId}`, "layout");
    return { kind: { id, name: data.name, suiteId: suite?.id ?? null, builtIn: false } };
  });
}

const kindsSchema = z.array(
  z.object({
    id: z.string().max(40).optional(),
    name: z.string().trim().min(1, "Name every kind.").max(60),
    suiteId: z.string().nullable().default(null),
    hidden: z.boolean().default(false),
  }),
);

/** Umbrella Settings → Run kinds (ver_95): rename or hide Smoke test and Release candidate, add, edit or remove custom kinds. */
export async function setRunKinds(groupId: string, input: z.input<typeof kindsSchema>) {
  return attempt(async () => {
    const list = kindsSchema.parse(input);
    const user = await requireUser();
    const umbrella = await loadUmbrella(groupId, user);
    if (!umbrella || !can(umbrella.who, "umbrella:fields")) throw new UserError("Only admins can change run kinds.");
    const suites = new Set((await db.testSuite.findMany({ where: { projectId: umbrella.hub.id, archived: false }, select: { id: true } })).map((s) => s.id));
    const seen = new Set<string>();
    const ids: string[] = [];
    const out = list.map((k) => {
      const low = k.name.toLowerCase();
      if (seen.has(low)) throw new UserError(`There's already a kind called ${k.name}.`);
      seen.add(low);
      const id = k.id || kindIdFor(k.name, ids);
      ids.push(id);
      return { id, name: id === "bash" ? "Bug bash" : k.name, suiteId: k.suiteId && suites.has(k.suiteId) ? k.suiteId : null, hidden: id === "bash" ? false : k.hidden };
    });
    await db.projectGroup.update({ where: { id: groupId }, data: { runKinds: out } });
    await logActivity({ actor: user, kind: "settings", action: "Changed run kinds", group: umbrella.group, detail: out.filter((k) => !k.hidden).map((k) => k.name).join(", ") });
    revalidatePath(`/g/${groupId}`, "layout");
    return { kinds: parseRunKinds(out) };
  });
}

const storedKinds = (kinds: ReturnType<typeof parseRunKinds>) => kinds.map((k) => ({ id: k.id, name: k.name, suiteId: k.suiteId, hidden: k.hidden }));
