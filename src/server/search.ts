"use server";

import { runTag } from "@/lib/run-label";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { attempt } from "./result";
import { cleanQuery, ENOUGH_EXACT, matchKind } from "@/lib/fuzzy";
import { toolById, toolsOn, type ToolId } from "@/lib/tools";
import { NOT_PRACTICE } from "@/lib/practice";

const CLOSE_MAX = 5;
/** Close matches among candidates the exact search didn't find. */
function closeOnes<T>(q: string, list: T[], name: (x: T) => string, skip: (x: T) => boolean, exactTotal: number, primary?: (x: T) => string) {
  if (exactTotal >= ENOUGH_EXACT) return [];
  const found = list.filter((x) => !skip(x) && matchKind(q, name(x)) === "close");
  // Ones whose title is close come before ones found by tag or folder.
  if (primary) found.sort((a, b) => Number(!!matchKind(q, primary(b))) - Number(!!matchKind(q, primary(a))));
  return found.slice(0, CLOSE_MAX);
}

// Ctrl+K search: find and open cases, runs, bugs, umbrellas and test cycles,
// suites and shared steps, and pages. Find only: it never creates or changes anything.

export type SearchKind = "cases" | "runs" | "bugs" | "cycles" | "suites" | "pages";
export type SearchHit = { href: string; label: string; key?: string; sub: string; archived?: boolean; best?: boolean; off?: { groupId: string; tool: ToolId; canTurnOn: boolean } };
/** `close`: spelled a bit differently, shown under their own label after the exact hits. */
export type SearchGroup = { kind: SearchKind; total: number; hits: SearchHit[]; close: SearchHit[]; seeAll?: string };
export type RecentItem = { href: string; label: string; kind: SearchKind; sub: string };

const PER_GROUP = 4;

/** The projects the viewer can open, inside the umbrella when one is given. */
async function scopeOf(user: { id: string; isAdmin: boolean }, groupId: string | null, archived: boolean) {
  const group = groupId ? await db.projectGroup.findFirst({ where: { id: groupId, hubProjectId: { not: null } }, select: { id: true, name: true, hubProjectId: true, tools: true } }) : null;
  const projects = await db.project.findMany({
    where: {
      ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }),
      ...NOT_PRACTICE,
      ...(archived ? {} : { archivedAt: null }),
      ...(group ? { OR: [{ id: group.hubProjectId! }, { groupId: group.id }] } : {}),
    },
    select: { id: true, key: true, name: true, archivedAt: true, groupId: true, rcName: true, platform: true, hubOf: { select: { id: true, name: true, tools: true } }, group: { select: { id: true, name: true, hubProjectId: true, archivedAt: true, tools: true } } },
  });
  // Tools: what each project's umbrella has turned off, so its cases, runs and pages stay out of the results.
  const offIn = new Map<string, Set<ToolId>>();
  for (const p of projects) {
    const tools = p.hubOf?.tools ?? (p.group?.hubProjectId ? p.group.tools : null);
    if (tools === null || tools === undefined) continue;
    const on = toolsOn(tools);
    offIn.set(p.id, new Set((Object.keys(toolById) as ToolId[]).filter((t) => !on.includes(t))));
  }
  /** The projects whose umbrella uses this tool. */
  const usingTool = (t: ToolId) => projects.filter((p) => !offIn.get(p.id)?.has(t)).map((p) => p.id);
  // Admins of an umbrella see Turn on next to a page that's off.
  const hubIds = projects.filter((p) => p.hubOf).map((p) => p.id);
  const adminOf = new Set(
    user.isAdmin ? hubIds : (await db.projectMember.findMany({ where: { userId: user.id, role: "ADMIN", projectId: { in: hubIds } }, select: { projectId: true } })).map((m) => m.projectId),
  );
  return { group, projects, usingTool, adminOf };
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

// Everyday words for each page, so "dark mode" finds Appearance.
const ACCOUNT_PAGES: { label: string; anchor: string; words: string }[] = [
  { label: "Profile", anchor: "profile", words: "profile name picture avatar photo" },
  { label: "Appearance", anchor: "appearance", words: "appearance theme dark mode light colors colours font accent" },
  { label: "Language", anchor: "language", words: "language english us uk spelling dates" },
  { label: "Your Jira email", anchor: "jira", words: "jira email reporter" },
  { label: "Accessibility", anchor: "accessibility", words: "accessibility text size motion contrast underline links" },
  { label: "Mini game", anchor: "game", words: "mini game xp titles quest" },
  { label: "Radio", anchor: "radio", words: "radio music spotify" },
  { label: "Password", anchor: "password", words: "password change password" },
];
/** `adminOnly`: only an umbrella's Admins see it (Members, ver_168). */
/** `sub`: where to go once there, shown under the label instead of the umbrella's name. */
const UMBRELLA_PAGES: { label: string; path: (g: string, hub: string) => string; words: string; tool?: ToolId; adminOnly?: true; sub?: string }[] = [
  { label: "Overview", path: (g) => `/g/${g}`, words: "overview home" },
  { label: "Case library", path: (_, h) => `/p/${h}/cases`, words: "case library cases tests", tool: "cases" },
  // ver_203: "import" and "export run" find these too.
  { label: "Import cases", path: (_, h) => `/p/${h}/import`, words: "import cases csv excel xlsx upload spreadsheet google sheets testrail qtest zephyr xray move from another tool", tool: "cases" },
  { label: "Export cases", path: (_, h) => `/p/${h}/cases?export=1`, words: "export download cases qase qtest testrail excel spreadsheet csv xlsx google sheets move to another tool", tool: "cases" },
  { label: "Test suites", path: (_, h) => `/p/${h}/suites`, words: "test suites suite plans", tool: "cases" },
  { label: "Shared steps", path: (_, h) => `/p/${h}/shared-steps`, words: "shared steps reusable", tool: "cases" },
  { label: "Personas", path: (_, h) => `/p/${h}/charters?tab=personas`, words: "personas test persona charters exploratory", tool: "charters" },
  { label: "Charters", path: (_, h) => `/p/${h}/charters`, words: "charters exploratory sessions tours checklists", tool: "charters" },
  { label: "Test runs", path: (g) => `/g/${g}/runs`, words: "test runs runs automated", tool: "runs" },
  { label: "Import results from a spreadsheet", path: (g) => `/g/${g}?start=run&what=sheet`, words: "update run from sheet spreadsheet import results excel csv xlsx google sheets in progress bring in", tool: "runs" },
  { label: "Export a run", path: (g) => `/g/${g}/runs`, words: "export run results download excel xlsx google sheets spreadsheet copy save in progress", tool: "runs", sub: "Open a run, then Import / Export" },
  { label: "Bug bashes", path: (_, h) => `/p/${h}/bashes`, words: "bug bashes bash blitz hunt", tool: "bashes" },
  { label: "Start a bug bash", path: (_, h) => `/p/${h}/bashes?bash=start`, words: "start new bug bash blitz", tool: "bashes" },
  { label: "Risk board", path: (_, h) => `/p/${h}/risk`, words: "risk board rc plan likelihood impact", tool: "risk" },
  { label: "Bugs", path: (g) => `/g/${g}/bugs`, words: "bugs defects jira issues" },
  { label: "Write a bug", path: (g) => `/g/${g}/bugs?write=1`, words: "write new bug report file log add create defect issue" },
  { label: "Reports", path: (g) => `/g/${g}/reports`, words: "reports charts trends" },
  { label: "Release status", path: (g) => `/g/${g}/rc`, words: "rc status release end of day eod confluence", tool: "runs" },
  { label: "Settings", path: (g) => `/g/${g}/settings`, words: "settings platforms" },
  { label: "Jira connection", path: (g) => `/g/${g}/settings#jira`, words: "jira connection token login" },
  { label: "Bug templates", path: (g) => `/g/${g}/settings#bug-templates`, words: "jira bug template templates layout fields" },
  { label: "Requirements settings", path: (g) => `/g/${g}/settings#stories`, words: "jira requirements requirement stories story epics links coverage", tool: "stories" },
  { label: "Members", path: (g) => `/g/${g}/settings#members`, words: "members team people invite", adminOnly: true },
  { label: "Roles", path: (g) => `/g/${g}/settings#roles`, words: "roles permissions tester lead admin" },
  { label: "Slack alerts", path: (g) => `/g/${g}/settings#slack`, words: "slack alerts notifications channel" },
  { label: "GitHub settings", path: (g) => `/g/${g}/settings#github`, words: "github connect pull repo token workflow actions ci", tool: "auto" },
  { label: "Repositories", path: (g) => `/g/${g}/repos`, words: "repositories repos github health pass rate ci", tool: "auto" },
];

/** `umbrella`: the one you're in. `everywhere`: on the Umbrellas page, every umbrella you can see. */
type PageScope = { id: string; name: string; hubKey: string; off: Set<ToolId>; admin: boolean };
/** A page whose tool is off still comes up, saying so, with Turn on for Admins. */
function pageHit(p: (typeof UMBRELLA_PAGES)[number], u: PageScope, label: string): SearchHit {
  const href = p.path(u.id, u.hubKey);
  if (p.tool && u.off.has(p.tool)) {
    const t = toolById[p.tool];
    const part = p.label === t.name ? "" : `Part of ${t.name}. `;
    return {
      href,
      label: label === p.label ? `${label} is off in ${u.name}` : `${label} (off)`,
      sub: `${part}${u.admin ? "Turn it on here, or in Settings → Tools" : "An Admin can turn it on in Settings → Tools"}`,
      off: { groupId: u.id, tool: p.tool, canTurnOn: u.admin },
    };
  }
  return { href, label, sub: p.sub ? `${u.name} · ${p.sub}` : u.name };
}

function pageHits(q: string, umbrella: PageScope | null, everywhere: PageScope[] = [], close = false): SearchHit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = close ? (text: string) => matchKind(q, text) === "close" : (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const hits: SearchHit[] = [];
  if (umbrella) for (const p of UMBRELLA_PAGES) if ((!p.adminOnly || umbrella.admin) && matches(`${p.label} ${p.words}`)) hits.push(pageHit(p, umbrella, p.label));
  for (const u of everywhere)
    for (const p of UMBRELLA_PAGES) if ((!p.adminOnly || u.admin) && matches(`${p.label} ${p.words} ${u.name}`)) hits.push(pageHit(p, u, `${u.name} · ${p.path(u.id, u.hubKey).includes("/settings#") ? `Settings → ${p.label}` : p.label}`));
  for (const p of ACCOUNT_PAGES) if (matches(`${p.label} ${p.words} account`)) hits.push({ href: `/account#${p.anchor}`, label: p.label, sub: "Your account" });
  if (matches("umbrellas home all projects")) hits.push({ href: "/", label: "Umbrellas", sub: "Every umbrella and test cycle" });
  if (matches("rc status release end of day")) hits.push({ href: "/rc", label: "Release status", sub: "Across every umbrella" });
  if (matches("feedback suggestion idea complaint screenshot tell us")) hits.push({ href: "/feedback", label: "Feedback", sub: "What you've told us about Flaw Patrol, and replies" });
  return hits;
}

/** The step a case matched on, as a short line. */
function stepSnippet(steps: unknown, q: string) {
  const needle = q.toLowerCase();
  const walk = (v: unknown): string | null => {
    if (typeof v === "string") return v.toLowerCase().includes(needle) ? v : null;
    if (Array.isArray(v)) {
      for (const x of v) {
        const hit = walk(x);
        if (hit) return hit;
      }
    } else if (v && typeof v === "object") for (const x of Object.values(v)) {
      const hit = walk(x);
      if (hit) return hit;
    }
    return null;
  };
  const hit = walk(steps);
  if (!hit) return null;
  const i = hit.toLowerCase().indexOf(needle);
  const start = Math.max(0, i - 30);
  return `${start ? "…" : ""}${hit.slice(start, i + needle.length + 40).replace(/\s+/g, " ")}${i + needle.length + 40 < hit.length ? "…" : ""}`;
}

const searchSchema = z.object({ q: z.string().max(200), groupId: z.string().nullable(), archived: z.boolean().default(false) });

export async function searchEverything(input: z.input<typeof searchSchema>) {
  return attempt(async () => {
    const user = await requireUser();
    const { q: raw, groupId, archived } = searchSchema.parse(input);
    // [WEB] looks for the tag WEB.
    const q = raw.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim();
    const { group, projects, usingTool, adminOf } = await scopeOf(user, groupId, archived);
    const hub = group ? projects.find((p) => p.id === group.hubProjectId) : null;
    const umbrella = group && hub ? { id: group.id, name: group.name, hubKey: hub.key } : null;
    const groups: SearchGroup[] = [];
    if (!q) return { groups, umbrella };
    const offOf = (tools: unknown) => new Set((Object.keys(toolById) as ToolId[]).filter((t) => !toolsOn(tools).includes(t)));
    const pageScope = umbrella && group && hub ? { ...umbrella, off: offOf(group.tools), admin: adminOf.has(hub.id) } : null;
    // Each kind only looks in umbrellas that use its tool.
    const ids = usingTool("cases");
    const runIds_ = usingTool("runs");
    const byId = new Map(projects.map((p) => [p.id, p]));
    const placeOf = (projectId: string) => {
      const p = byId.get(projectId);
      if (!p) return "";
      if (p.hubOf) return `${p.hubOf.name} case library`;
      return p.group?.hubProjectId && !group ? `${p.group.name} › ${p.name}` : p.name;
    };
    const pat = like(q);
    const keyMatch = q.match(/^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/);
    const bareNumber = /^\d+$/.test(q) ? Number(q) : null;

    // Test cases: key (or bare number), name, tags, step text, old tool key.
    const caseRows = ids.length
      ? await db.$queryRaw<{ id: string; total: bigint }[]>`
          SELECT c.id, count(*) OVER () AS total
          FROM "TestCase" c
          JOIN "CaseVersion" v ON v."caseId" = c.id AND v.version = c."currentVersion"
          JOIN "Project" p ON p.id = c."projectId"
          WHERE c."projectId" IN (${Prisma.join(ids)})
            ${archived ? Prisma.empty : Prisma.sql`AND c.archived = false`}
            AND (
              c.title ILIKE ${pat} OR v.steps::text ILIKE ${pat} OR array_to_string(c.tags, ' ') ILIKE ${pat} OR coalesce(c."sourceKey", '') ILIKE ${pat}
              ${keyMatch ? Prisma.sql`OR (upper(p.key) = ${keyMatch[1].toUpperCase()} AND c.number = ${Number(keyMatch[2])})` : Prisma.empty}
              ${bareNumber !== null ? Prisma.sql`OR c.number = ${bareNumber}` : Prisma.empty}
            )
          ORDER BY ${keyMatch ? Prisma.sql`(upper(p.key) = ${keyMatch[1].toUpperCase()} AND c.number = ${Number(keyMatch[2])}) DESC,` : bareNumber !== null ? Prisma.sql`(c.number = ${bareNumber}) DESC,` : Prisma.empty}
                   (c.title ILIKE ${pat}) DESC, c."updatedAt" DESC
          LIMIT ${PER_GROUP}`
      : [];
    // Close matches on case titles, tags and folders, never step text.
    const caseTotal = caseRows.length ? Number(caseRows[0].total) : 0;
    const caseCands =
      ids.length && caseTotal < ENOUGH_EXACT && cleanQuery(q).length > 1
        ? await db.testCase.findMany({ where: { projectId: { in: ids }, ...(archived ? {} : { archived: false }) }, select: { id: true, title: true, tags: true, number: true, archived: true, projectId: true, folder: { select: { name: true } }, project: { select: { key: true } } }, orderBy: { updatedAt: "desc" }, take: 5000 })
        : [];
    const exactCaseIds = new Set(caseRows.map((r) => r.id));
    const caseClose = closeOnes(q, caseCands, (c) => `${c.title} ${c.tags.join(" ")} ${c.folder?.name ?? ""}`, (c) => exactCaseIds.has(c.id), caseTotal, (c) => `${c.title} ${c.tags.join(" ")}`).map((c) => ({
      href: `/p/${c.project.key}/cases/${c.number}`,
      key: caseKey(c.project.key, c.number),
      label: c.title,
      sub: [c.tags.length ? c.tags.join(", ") : c.folder?.name, placeOf(c.projectId)].filter(Boolean).join(" · "),
      archived: c.archived,
    }));
    if (caseRows.length || caseClose.length) {
      const cases = await db.testCase.findMany({
        where: { id: { in: caseRows.map((r) => r.id) } },
        include: { project: { select: { key: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { steps: true, folderPath: true } } },
      });
      const order = new Map(caseRows.map((r, i) => [r.id, i]));
      cases.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      const seeAllProject = hub ?? (projects.length === 1 ? projects[0] : null);
      groups.push({
        kind: "cases",
        total: caseTotal,
        close: caseClose,
        seeAll: seeAllProject ? `/p/${seeAllProject.key}/cases?q=${encodeURIComponent(q)}` : undefined,
        hits: cases.map((c) => {
          const key = caseKey(c.project.key, c.number);
          const exact = (keyMatch && key.toUpperCase() === q.toUpperCase()) || (bareNumber !== null && c.number === bareNumber);
          const inTitle = c.title.toLowerCase().includes(q.toLowerCase());
          const step = !inTitle && !exact ? stepSnippet(c.versions[0]?.steps, q) : null;
          return {
            href: `/p/${c.project.key}/cases/${c.number}`,
            key,
            label: c.title,
            sub: [step ? `Step: ${step}` : c.versions[0]?.folderPath, placeOf(c.projectId)].filter(Boolean).join(" · "),
            archived: c.archived,
            best: !!exact,
          };
        }),
      });
    }

    // Test runs: name, RC, build.
    // "R1" still finds every test cycle's run 1 (old habit), shown by its version (ver_189).
    const runNumber = /^R(\d+)$/i.exec(q);
    const runWhere: Prisma.TestRunWhereInput = {
      projectId: { in: runIds_ },
      OR: [{ name: { contains: q, mode: "insensitive" } }, { release: { contains: q, mode: "insensitive" } }, { build: { contains: q, mode: "insensitive" } }, ...(runNumber ? [{ number: Number(runNumber[1]) }] : [])],
    };
    const [runTotal, runs] = await Promise.all([
      db.testRun.count({ where: runWhere }),
      db.testRun.findMany({ where: runWhere, orderBy: { createdAt: "desc" }, take: PER_GROUP, include: { project: { select: { key: true } }, entries: { select: { status: true } } } }),
    ]);
    const runCands = runTotal < ENOUGH_EXACT && cleanQuery(q).length > 1 ? await db.testRun.findMany({ where: { projectId: { in: runIds_ } }, orderBy: { createdAt: "desc" }, take: 2000, select: { id: true, number: true, name: true, release: true, build: true, createdAt: true, projectId: true, state: true, project: { select: { key: true } } } }) : [];
    const runIds = new Set(runs.map((r) => r.id));
    const runClose = closeOnes(q, runCands, (r) => `${r.name} ${r.release} ${r.build}`, (r) => runIds.has(r.id), runTotal).map((r) => ({
      href: `/p/${r.project.key}/runs/${r.number}`,
      key: runTag(r),
      label: r.name,
      sub: [placeOf(r.projectId), r.release && `Release ${r.release}`, r.state === "ACTIVE" ? "Active" : "Closed"].filter(Boolean).join(" · "),
    }));
    if (runTotal || runClose.length)
      groups.push({
        kind: "runs",
        total: runTotal,
        close: runClose,
        seeAll: group ? `/g/${group.id}/runs` : undefined,
        hits: runs.map((r) => {
          const done = r.entries.filter((e) => !["UNTESTED", "RETEST", "IN_PROGRESS"].includes(e.status)).length;
          return {
            href: `/p/${r.project.key}/runs/${r.number}`,
            key: runTag(r),
            label: r.name,
            best: !!runNumber && r.number === Number(runNumber[1]),
            sub: [placeOf(r.projectId), r.release && `Release ${r.release}`, r.automated ? "🤖 Automated" : `${r.entries.length ? Math.round((done / r.entries.length) * 100) : 0}% done`, r.state === "ACTIVE" ? "Active" : "Closed"].filter(Boolean).join(" · "),
          };
        }),
      });

    // Bugs: Jira key, title.
    const allIds = projects.map((p) => p.id);
    const bugWhere: Prisma.DefectWhereInput = { projectId: { in: allIds }, OR: [{ title: { contains: q, mode: "insensitive" } }, { externalKey: { contains: q, mode: "insensitive" } }] };
    const [bugTotal, bugs] = await Promise.all([
      db.defect.count({ where: bugWhere }),
      db.defect.findMany({ where: bugWhere, orderBy: { createdAt: "desc" }, take: 20, include: { project: { select: { key: true, groupId: true } } } }),
    ]);
    const bugCands = bugTotal < ENOUGH_EXACT && cleanQuery(q).length > 1 ? await db.defect.findMany({ where: { projectId: { in: allIds } }, orderBy: { createdAt: "desc" }, take: 3000, include: { project: { select: { key: true, groupId: true } } } }) : [];
    const bugIds = new Set(bugs.map((b) => b.id));
    const bugCloseRaw = closeOnes(q, bugCands, (d) => `${d.title} ${d.externalKey ?? ""}`, (d) => bugIds.has(d.id), bugTotal);
    if (bugTotal || bugCloseRaw.length) {
      // An exact Jira key goes first; the same Jira issue filed from two test cycles shows once.
      const seen = new Set<string>();
      const list = bugs
        .sort((a, b) => Number(b.externalKey?.toUpperCase() === q.toUpperCase()) - Number(a.externalKey?.toUpperCase() === q.toUpperCase()))
        .filter((d) => {
          const k = d.externalKey ?? d.id;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, PER_GROUP);
      const bugsPage = (d: (typeof bugs)[number]) => {
        const g = byId.get(d.projectId)?.hubOf?.id ?? (byId.get(d.projectId)?.group?.hubProjectId ? byId.get(d.projectId)!.group!.id : null);
        return g ? `/g/${g}/bugs?all=1&q=${encodeURIComponent(d.externalKey ?? d.title)}` : `/p/${d.project.key}/bugs`;
      };
      groups.push({
        kind: "bugs",
        total: bugTotal,
        seeAll: group ? `/g/${group.id}/bugs?all=1&q=${encodeURIComponent(q)}` : undefined,
        hits: list.map((d) => ({
          href: bugsPage(d),
          key: d.externalKey ?? `D-${d.number}`,
          label: d.title,
          sub: [d.externalStatus ?? (d.status === "OPEN" ? "Open" : d.status.toLowerCase().replace("_", " ")), placeOf(d.projectId)].filter(Boolean).join(" · "),
          best: d.externalKey?.toUpperCase() === q.toUpperCase(),
        })),
        close: bugCloseRaw.map((d) => ({ href: bugsPage(d), key: d.externalKey ?? `D-${d.number}`, label: d.title, sub: [d.externalStatus ?? (d.status === "OPEN" ? "Open" : d.status.toLowerCase().replace("_", " ")), placeOf(d.projectId)].filter(Boolean).join(" · ") })),
      });
    }

    // Umbrellas (when searching everywhere) and test cycles: name, RC, platform.
    const needle = q.toLowerCase();
    const umbrellas = group
      ? []
      : [...new Map(projects.filter((p) => p.hubOf && p.hubOf.name.toLowerCase().includes(needle)).map((p) => [p.hubOf!.id, p])).values()].map((p) => ({
          href: `/g/${p.hubOf!.id}`,
          label: p.hubOf!.name,
          sub: "Umbrella",
          archived: false,
        }));
    const withRuns = new Set(runIds_);
    const cycles = projects
      .filter((p) => !p.hubOf && withRuns.has(p.id) && [p.name, p.rcName, p.platform, p.key].some((t) => t.toLowerCase().includes(needle)))
      .map((p) => ({ href: `/p/${p.key}`, label: p.name, sub: ["Test cycle", p.group?.hubProjectId && !group ? p.group.name : null].filter(Boolean).join(" · "), archived: !!p.archivedAt }));
    const cycleHits = [...umbrellas, ...cycles];
    const cycleClose = closeOnes(
      q,
      [
        ...(group ? [] : [...new Map(projects.filter((p) => p.hubOf).map((p) => [p.hubOf!.id, p])).values()].map((p) => ({ href: `/g/${p.hubOf!.id}`, label: p.hubOf!.name, sub: "Umbrella", archived: false, text: p.hubOf!.name }))),
        ...projects.filter((p) => !p.hubOf && withRuns.has(p.id)).map((p) => ({ href: `/p/${p.key}`, label: p.name, sub: ["Test cycle", p.group?.hubProjectId && !group ? p.group.name : null].filter(Boolean).join(" · "), archived: !!p.archivedAt, text: `${p.name} ${p.rcName} ${p.platform}` })),
      ],
      (x) => x.text,
      (x) => cycleHits.some((h) => h.href === x.href),
      cycleHits.length,
    ).map(({ text: _t, ...h }) => h); // eslint-disable-line @typescript-eslint/no-unused-vars
    if (cycleHits.length || cycleClose.length) groups.push({ kind: "cycles", total: cycleHits.length, hits: cycleHits.slice(0, PER_GROUP), close: cycleClose, seeAll: group && cycles.length > PER_GROUP ? `/g/${group.id}/projects` : undefined });

    // Suites and shared steps: name.
    const [suites, shared] = await Promise.all([
      db.testSuite.findMany({ where: { projectId: { in: ids }, name: { contains: q, mode: "insensitive" }, ...(archived ? {} : { archived: false }) }, take: 20, include: { project: { select: { key: true } }, _count: { select: { cases: true } } } }),
      db.sharedStep.findMany({ where: { projectId: { in: ids }, name: { contains: q, mode: "insensitive" }, ...(archived ? {} : { archived: false }) }, take: 20, include: { project: { select: { key: true } }, _count: { select: { usages: true } } } }),
    ]);
    const libHits: SearchHit[] = [
      ...suites.map((s) => ({ href: `/p/${s.project.key}/suites/${s.id}`, label: s.name, sub: [`Suite v${s.currentVersion}`, `${s._count.cases} ${s._count.cases === 1 ? "case" : "cases"}`, placeOf(s.projectId)].join(" · "), archived: s.archived })),
      ...shared.map((s) => ({ href: `/p/${s.project.key}/shared-steps/${s.id}`, label: s.name, sub: [`Shared step v${s.currentVersion}`, `used by ${s._count.usages} ${s._count.usages === 1 ? "case" : "cases"}`, placeOf(s.projectId)].join(" · "), archived: s.archived })),
    ];
    const [suiteCands, sharedCands] =
      libHits.length < ENOUGH_EXACT && cleanQuery(q).length > 1
        ? await Promise.all([
            db.testSuite.findMany({ where: { projectId: { in: ids }, ...(archived ? {} : { archived: false }) }, take: 2000, select: { id: true, name: true, archived: true, projectId: true, project: { select: { key: true } } } }),
            db.sharedStep.findMany({ where: { projectId: { in: ids }, ...(archived ? {} : { archived: false }) }, take: 2000, select: { id: true, name: true, archived: true, projectId: true, project: { select: { key: true } } } }),
          ])
        : [[], []];
    const libClose = closeOnes(
      q,
      [...suiteCands.map((x) => ({ ...x, href: `/p/${x.project.key}/suites/${x.id}`, what: "Suite" })), ...sharedCands.map((x) => ({ ...x, href: `/p/${x.project.key}/shared-steps/${x.id}`, what: "Shared step" }))],
      (x) => x.name,
      (x) => libHits.some((h) => h.href === x.href),
      libHits.length,
    ).map((x) => ({ href: x.href, label: x.name, sub: [x.what, placeOf(x.projectId)].join(" · "), archived: x.archived }));
    if (libHits.length || libClose.length) groups.push({ kind: "suites", total: libHits.length, hits: libHits.slice(0, PER_GROUP), close: libClose });

    const everywhere = group ? [] : [...new Map(projects.filter((p) => p.hubOf).map((p) => [p.hubOf!.id, { id: p.hubOf!.id, name: p.hubOf!.name, hubKey: p.key, off: offOf(p.hubOf!.tools), admin: adminOf.has(p.id) }])).values()];
    const pages = pageHits(q, pageScope, everywhere);
    const pageClose = pages.length < ENOUGH_EXACT && cleanQuery(q).length > 1 ? pageHits(q, pageScope, everywhere, true).filter((h) => !pages.some((x) => x.href === h.href)).slice(0, CLOSE_MAX) : [];
    if (pages.length || pageClose.length) groups.push({ kind: "pages", total: pages.length, hits: pages.slice(0, PER_GROUP), close: pageClose });

    // The exact key, wherever it was found, leads.
    groups.sort((a, b) => Number(b.hits.some((h) => h.best)) - Number(a.hits.some((h) => h.best)));
    return { groups, umbrella };
  });
}

/** Before typing: your last 5 opened, and Go to pages for the umbrella you're in. */
export async function searchStart(groupId: string | null) {
  return attempt(async () => {
    const user = await requireUser();
    const recent = (Array.isArray(user.searchRecent) ? (user.searchRecent as RecentItem[]) : []).slice(0, 5);
    const { group, projects } = groupId ? await scopeOf(user, groupId, false) : { group: null, projects: [] };
    const hub = group ? projects.find((p) => p.id === group.hubProjectId) : null;
    const on = group ? toolsOn(group.tools) : [];
    const goTo: SearchHit[] = group && hub ? UMBRELLA_PAGES.filter((p) => (!p.tool || on.includes(p.tool)) && !p.adminOnly).slice(0, 7).map((p) => ({ href: p.path(group.id, hub.key), label: p.label, sub: group.name })) : [];
    return { recent, goTo, umbrella: group && hub ? { id: group.id, name: group.name } : null };
  });
}

const recentSchema = z.object({ href: z.string().max(500).startsWith("/"), label: z.string().max(300), kind: z.enum(["cases", "runs", "bugs", "cycles", "suites", "pages"]), sub: z.string().max(300) });

/** Remember what someone opened from search, newest first, five at most. */
export async function rememberOpened(item: z.input<typeof recentSchema>) {
  return attempt(async () => {
    const user = await requireUser();
    const it = recentSchema.parse(item);
    const list = (Array.isArray(user.searchRecent) ? (user.searchRecent as RecentItem[]) : []).filter((r) => r.href !== it.href);
    await db.user.update({ where: { id: user.id }, data: { searchRecent: [it, ...list].slice(0, 5) as Prisma.InputJsonValue } });
    return {};
  });
}
