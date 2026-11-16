"use server";

import { runTitle } from "@/lib/run-label";
import { assignable } from "@/lib/assignable";
import { askForMemberAccess } from "./join-requests";
import { libraryCaseNews } from "@/lib/case-news-data";
import { NOT_BASH_CASE } from "@/lib/bash-cases";
import { tagColorsFor } from "@/lib/tag-data";
import { CSP_FIELD, parseRunFields } from "@/lib/run-fields";
import { kindIdFor, parseRunKinds } from "@/lib/run-kinds";
import { toolsOn } from "@/lib/tools";
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
import { NOT_BASH_RUN } from "@/lib/bash-cases";
import { MAX_CONFIGURATIONS, MAX_PLAN_RUNS, MAX_VALUE_LENGTH, MAX_VALUES, pairingCount, parseConfigurations, type PlanConfig } from "@/lib/configurations";
import { makePlan, runSourceFor, type PlanSource } from "@/lib/plans-server";

// The Create a run box: pick what to run from the library (all of it, a
// suite, or ticked cases), then the test cycles to run it in, one run in each.

export type RunBoxScope = { projectKey: string } | { groupId: string };

export type RunBoxCycle = { id: string; key: string; name: string; color: string; current: boolean; rcName: string; members: { id: string; name: string }[] };

const viewerLine = (team: string) => `You're a Viewer in ${team}. Ask an admin for Member access to start runs.`;

/** The Create a run box's Ask for Member access, for a Viewer who opened it: asks in the umbrella's team. */
export async function askAccessFromRunBox(scope: RunBoxScope, path: string) {
  const user = await requireUser();
  let projectId: string | null = null;
  if ("projectKey" in scope) {
    const p = await db.project.findUnique({ where: { key: scope.projectKey.toUpperCase() }, select: { id: true, key: true, name: true, groupId: true, rcName: true } });
    const u = p ? await umbrellaOf(p) : null;
    projectId = u ? u.hub.id : (p?.id ?? null);
  } else projectId = (await loadUmbrella(scope.groupId, user))?.hub.id ?? null;
  if (!projectId) return { ok: false as const, error: "This umbrella isn't available." };
  return askForMemberAccess(projectId, path);
}

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
    // make the first one, for whoever the Roles card lets add a test cycle.
    // (Non-admins only see their own test cycles here, so count them all.)
    const empty = !!umbrella && !cycles.length && !(await db.project.count({ where: { groupId: umbrella.group.id, archivedAt: null } }));
    // Since ver_95 step 2 always ends with "+ New test cycle", made when you press Start.
    const newCycle = umbrella ? { empty, canCreate: can(umbrella.who, "cycle:create") && !umbrella.group.archivedAt, platforms: umbrella.platforms.map((p) => p.name) } : null;

    // Only test cycles the viewer can start runs in, under the umbrella's (or this test cycle's) Roles card.
    const rules = umbrella ? umbrella.who.rules : here ? await roleRulesFor(here) : null;
    const roles = await db.projectMember.findMany({ where: { userId: user.id, projectId: { in: cycles.map((c) => c.id) } }, select: { projectId: true, role: true } });
    const roleOf = new Map<string, Role>(roles.map((r) => [r.projectId, r.role]));
    cycles = cycles.filter((c) => can({ role: user.isAdmin ? "ADMIN" : (roleOf.get(c.id) ?? null), rules }, "run:create"));
    // A Viewer gets the way up instead of a dead end; the box offers Ask for Member access.
    if (!cycles.length && !empty && !newCycle?.canCreate && umbrella?.who.role === "VIEWER") throw new UserError(viewerLine(umbrella.group.name));
    if (!cycles.length && !empty && !newCycle?.canCreate) throw new UserError(umbrella ? `You can't start runs in any ${umbrella.group.name} test cycle yet. Ask an admin to add you to one.` : "You can't start runs here.");

    const libIds = await libraryProjectIds(library);
    const wholeLib = { projectId: umbrella ? umbrella.hub.id : library.id, archived: false, ...NOT_BASH_CASE };
    const [picker, suites, members, allCount, autoCount] = await Promise.all([
      suitePickerData(library),
      db.testSuite.findMany({
        where: { projectId: { in: libIds }, archived: false },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          projectId: true,
          _count: { select: { cases: { where: { testCase: { archived: false } } } } },
          // Automated-only cases in it, left out unless "Also include the automated cases" is ticked.
          cases: { where: { testCase: { archived: false, type: "AUTOMATED" } }, select: { caseId: true } },
        },
      }),
      Promise.all(cycles.map((c) => projectMembers(c.id))),
      // "Whole Case library": the umbrella's library, or a lone project's own cases.
      // Counted without the automated-only ones: automation already runs those.
      db.testCase.count({ where: { ...wholeLib, type: { not: "AUTOMATED" } } }),
      db.testCase.count({ where: { ...wholeLib, type: "AUTOMATED" } }),
    ]);
    // From a spreadsheet (ver_177): test cycles where the viewer can bring in results, with their runs in progress.
    const importRules = (c: { id: string }) => can({ role: user.isAdmin ? "ADMIN" : (roleOf.get(c.id) ?? null), rules }, "run:import");
    const sheetIds = cycles.filter(importRules).map((c) => c.id);
    const openRuns = sheetIds.length
      ? await db.testRun.findMany({
          where: { projectId: { in: sheetIds }, state: "ACTIVE", automated: false, ...NOT_BASH_RUN },
          orderBy: { createdAt: "desc" },
          select: { projectId: true, number: true, name: true, build: true, createdAt: true, entries: { select: { status: true } } },
        })
      : [];
    const colorOf = (platform: string) => (umbrella ? platformColor(umbrella.platforms, platform) : "#94a3b8");
    // Run kinds: what kind of run it is, asked first in an umbrella.
    // Without Bug bashes the Bug bash kind isn't offered.
    const kinds = umbrella ? parseRunKinds(umbrella.group.runKinds).filter((k) => !k.hidden && (k.id !== "bash" || toolsOn(umbrella.group.tools).includes("bashes"))) : [];
    return {
      umbrella: umbrella ? { id: umbrella.group.id, name: umbrella.group.name, hubKey: umbrella.hub.key } : null,
      // The test cycle the box was opened from, ticked for you.
      hereId: here?.id ?? null,
      newCycle,
      kinds: kinds.map((k) => ({ id: k.id, name: k.name, suiteId: k.suiteId, builtIn: k.builtIn })),
      // Release candidate opens the release box, which needs the umbrella:rc permission.
      canRc: !!umbrella && can(umbrella.who, "umbrella:rc") && !umbrella.group.archivedAt,
      // The latest release-candidate test cycle, for the kind's line ("carries over from Demo RC 1").
      lastCycle: umbrella ? (umbrella.current.find((p) => p.rcName)?.rcName || umbrella.current[0]?.name || "") : "",
      meId: user.id,
      // Configurations: "Test on these Configurations" ticks, umbrellas only.
      configurations: umbrella ? parseConfigurations(umbrella.group.configurations).filter((c) => c.values.length) : [],
      // Run fields: the umbrella's, or CSP version for a test cycle outside one.
      runFields: umbrella ? parseRunFields(umbrella.group.runFields) : [CSP_FIELD],
      cycles: cycles.map((c, i): RunBoxCycle => ({ id: c.id, key: c.key, name: c.name, color: colorOf(c.platform), current: c.current, rcName: c.rcName, members: assignable(members[i]).map((m) => ({ id: m.id, name: m.name })) })),
      sheetCycles: cycles
        .filter((c) => sheetIds.includes(c.id))
        .map((c) => ({
          id: c.id,
          key: c.key,
          name: c.name,
          runs: openRuns.filter((r) => r.projectId === c.id).map((r) => ({ number: r.number, name: r.name, title: runTitle(r), total: r.entries.length, tested: r.entries.filter((e) => e.status !== "UNTESTED").length })),
        })),
      allCount,
      autoCount,
      // Whether the "Make a suite", "Write the first case" and "Import cases" links show.
      canSuites: umbrella ? can(umbrella.who, "suite:manage") : true,
      canCases: umbrella ? can(umbrella.who, "case:edit") : true,
      canImport: umbrella ? can(umbrella.who, "import") : true,
      tagColors: await tagColorsFor(library.id),
      suites: suites.map((s) => ({ id: s.id, name: s.name, cases: s._count.cases, autoCases: s.cases.length, ownerId: s.projectId, shared: !!umbrella && s.projectId !== here?.id })),
      ...picker,
      // New and Updated cases, by case id.
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
  /** "Use each test cycle's own" release: a blank release otherwise stays blank. */
  cycleRelease: z.boolean().default(false),
  /** The run kind picked first. */
  runKind: z.string().trim().max(40).default(""),
  /** "Also include the automated cases". Off, Whole Case library and suites leave them out. */
  withAutomated: z.boolean().default(false),
  /** Configurations: values ticked under "Test on these Configurations", by Configuration id. */
  configs: z.array(z.object({ id: z.string().max(40), values: z.array(z.string().max(MAX_VALUE_LENGTH)).max(MAX_VALUES) })).max(MAX_CONFIGURATIONS).default([]),
});

/** Start one run in each ticked test cycle, or a test plan in each when Configuration values are ticked. */
export async function startRuns(input: z.input<typeof startSchema>) {
  return attempt(async () => {
    const data = startSchema.parse(input);
    if (data.what === "suite" && !data.suiteId) throw new UserError("Pick a suite to run.");
    if (data.what === "cases" && !data.caseIds?.length) throw new UserError("Tick at least one case to run.");
    const spec: PlanSource = { what: data.what, suiteId: data.suiteId, caseIds: data.caseIds, withAutomated: data.withAutomated };
    const picks = await pickedConfigs(data.cycleIds[0], data.configs);
    const started: { key: string; number: number; name: string }[] = [];
    const plans: { key: string; number: number; runs: { number: number }[] }[] = [];
    for (const cycleId of [...new Set(data.cycleIds)]) {
      const { project, user } = await requireProjectAction(cycleId, "run:create");
      // Cases go to the chosen tester only where they're on the team.
      const member = data.assigneeId ? await db.projectMember.findUnique({ where: { projectId_userId: { projectId: cycleId, userId: data.assigneeId } } }) : null;
      const details = {
        description: data.description,
        build: data.build,
        cspVersion: data.cspVersion,
        fields: data.fields,
        environment: data.environment,
        release: data.release || (data.cycleRelease ? project.rcName : ""),
        runKind: data.runKind,
        withAutomated: data.withAutomated,
      };
      if (picks.length) {
        // Configurations ticked: a test plan here, one run per value or pairing.
        try {
          const plan = await makePlan(project, user, { name: data.name, configs: picks, source: spec, details, assigneeId: member ? data.assigneeId : null });
          plans.push({ key: project.key, number: plan.planNumber, runs: plan.runs });
          started.push(...plan.runs.map((r) => ({ key: project.key, number: r.number, name: project.name })));
        } catch (e) {
          if (e instanceof UserError && started.length) throw new UserError(stopped(started, project.name, e.message));
          throw e;
        }
        revalidatePath(`/p/${project.key}`, "layout");
        continue;
      }
      let source: Parameters<typeof createRun>[1];
      try {
        // Whole Case library and suites leave out automated-only cases unless asked;
        // cases ticked one by one always go in.
        source = await runSourceFor(project, spec);
      } catch (e) {
        if (e instanceof UserError && started.length) throw new UserError(stopped(started, project.name, "it has none of these cases"));
        throw e;
      }
      const res = await createRun(cycleId, source, { ...details, name: data.name, assigneeId: member ? data.assigneeId : null });
      if (!res.ok) throw new UserError(started.length ? stopped(started, project.name, res.error) : `${project.name}: ${res.error}`);
      started.push({ key: project.key, number: res.number, name: project.name });
    }
    return { runs: started, plans };
  });
}

/** The ticked values, checked against the umbrella's Configurations, in its order. */
async function pickedConfigs(cycleId: string | undefined, ticks: { id: string; values: string[] }[]): Promise<PlanConfig[]> {
  if (!cycleId || !ticks.some((t) => t.values.length)) return [];
  const project = await db.project.findUnique({ where: { id: cycleId }, select: { id: true, groupId: true } });
  const u = project ? await umbrellaOf(project) : null;
  if (!u) throw new UserError("Configurations are set up in an umbrella. This test cycle isn't in one.");
  const configs = parseConfigurations(u.group.configurations);
  const out: PlanConfig[] = [];
  for (const c of configs) {
    const t = ticks.find((x) => x.id === c.id);
    if (!t?.values.length) continue;
    const want = new Set(t.values);
    const values = c.values.filter((v) => want.has(v));
    if (values.length) out.push({ name: c.name, values });
  }
  if (!out.length) throw new UserError("Those values aren't in the umbrella's Configurations anymore. Close the box and try again.");
  const runs = pairingCount(out);
  if (runs > MAX_PLAN_RUNS) throw new UserError(`That makes ${runs} runs. A test plan holds up to ${MAX_PLAN_RUNS}, so untick some values.`);
  return out;
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

/** Step 2 of Create a run in an umbrella with no test cycles: make the first one right there. */
export async function createCycleFromRunBox(groupId: string, input: { name: string; platform: string }) {
  return attempt(async () => {
    const name = z.string().trim().min(1, "Give the test cycle a name").max(100).parse(input.name);
    const platform = z.string().trim().max(30).parse(input.platform);
    const res = await addUmbrellaProject(groupId, { name, platform, key: await keyFromName(name) });
    if (!res.ok) throw new UserError(res.error);
    const user = await requireUser();
    const [p, umbrella] = await Promise.all([db.project.findUniqueOrThrow({ where: { key: res.key } }), loadUmbrella(groupId, user)]);
    const members = await projectMembers(p.id);
    const cycle: RunBoxCycle = { id: p.id, key: p.key, name: p.name, color: umbrella ? platformColor(umbrella.platforms, p.platform) : "#94a3b8", current: true, rcName: p.rcName, members: assignable(members).map((m) => ({ id: m.id, name: m.name })) };
    return { cycle };
  });
}

const kindSchema = z.object({
  name: z.string().trim().min(1, "Name the kind of run.").max(60, "Keep the name under 60 characters."),
  suiteId: z.string().nullable().default(null),
});

/** "+ New kind…" in Create a run: added to the umbrella and used at once. Anyone who can start runs can add one. */
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

/** Umbrella Settings → Run kinds: rename or hide Smoke test and Release candidate, add, edit or remove custom kinds. */
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
