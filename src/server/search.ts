"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { attempt } from "./result";

// Ctrl+K search (ver_82): find and open cases, runs, bugs, umbrellas and test cycles,
// suites and shared steps, and pages. Find only: it never creates or changes anything.

export type SearchKind = "cases" | "runs" | "bugs" | "cycles" | "suites" | "pages";
export type SearchHit = { href: string; label: string; key?: string; sub: string; archived?: boolean; best?: boolean };
export type SearchGroup = { kind: SearchKind; total: number; hits: SearchHit[]; seeAll?: string };
export type RecentItem = { href: string; label: string; kind: SearchKind; sub: string };

const PER_GROUP = 4;

/** The projects the viewer can open, inside the umbrella when one is given. */
async function scopeOf(user: { id: string; isAdmin: boolean }, groupId: string | null, archived: boolean) {
  const group = groupId ? await db.projectGroup.findFirst({ where: { id: groupId, hubProjectId: { not: null } }, select: { id: true, name: true, hubProjectId: true } }) : null;
  const projects = await db.project.findMany({
    where: {
      ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }),
      ...(archived ? {} : { archivedAt: null }),
      ...(group ? { OR: [{ id: group.hubProjectId! }, { groupId: group.id }] } : {}),
    },
    select: { id: true, key: true, name: true, archivedAt: true, groupId: true, rcName: true, platform: true, hubOf: { select: { id: true, name: true } }, group: { select: { id: true, name: true, hubProjectId: true, archivedAt: true } } },
  });
  return { group, projects };
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
const UMBRELLA_PAGES: { label: string; path: (g: string, hub: string) => string; words: string }[] = [
  { label: "Overview", path: (g) => `/g/${g}`, words: "overview home" },
  { label: "Case library", path: (_, h) => `/p/${h}/cases`, words: "case library cases tests" },
  { label: "Test suites", path: (_, h) => `/p/${h}/suites`, words: "test suites suite plans" },
  { label: "Shared steps", path: (_, h) => `/p/${h}/shared-steps`, words: "shared steps reusable" },
  { label: "Personas", path: (_, h) => `/p/${h}/personas`, words: "personas charters exploratory" },
  { label: "Charters", path: (_, h) => `/p/${h}/charters`, words: "charters exploratory sessions tours checklists" },
  { label: "Test runs", path: (g) => `/g/${g}/runs`, words: "test runs runs automated" },
  { label: "Bug bashes", path: (_, h) => `/p/${h}/bashes`, words: "bug bashes bash blitz hunt" },
  { label: "Start a bug bash", path: (_, h) => `/p/${h}/bashes?bash=start`, words: "start new bug bash blitz" },
  { label: "Risk board", path: (_, h) => `/p/${h}/risk`, words: "risk board rc plan likelihood impact" },
  { label: "Bugs", path: (g) => `/g/${g}/bugs`, words: "bugs defects jira issues" },
  { label: "Reports", path: (g) => `/g/${g}/reports`, words: "reports charts trends" },
  { label: "Release status", path: (g) => `/g/${g}/rc`, words: "rc status release end of day eod confluence" },
  { label: "Settings", path: (g) => `/g/${g}/settings`, words: "settings platforms" },
  { label: "Jira connection", path: (g) => `/g/${g}/settings#jira`, words: "jira connection token login" },
  { label: "Bug template", path: (g) => `/g/${g}/settings#template`, words: "jira bug template layout fields" },
  { label: "Requirements settings", path: (g) => `/g/${g}/settings#stories`, words: "jira requirements requirement stories story epics links coverage" },
  { label: "Members", path: (g) => `/g/${g}/settings#members`, words: "members team people invite" },
  { label: "Roles", path: (g) => `/g/${g}/settings#roles`, words: "roles permissions tester lead admin" },
  { label: "Slack alerts", path: (g) => `/g/${g}/settings#slack`, words: "slack alerts notifications channel" },
  { label: "GitHub settings", path: (g) => `/g/${g}/settings#github`, words: "github connect pull repo token workflow actions ci" },
  { label: "Repositories", path: (g) => `/g/${g}/repos`, words: "repositories repos github health pass rate ci" },
];

/** `umbrella`: the one you're in. `everywhere`: on the Umbrellas page, every umbrella you can see (ver_89). */
function pageHits(q: string, umbrella: { id: string; name: string; hubKey: string } | null, everywhere: { id: string; name: string; hubKey: string }[] = []): SearchHit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const hits: SearchHit[] = [];
  if (umbrella) for (const p of UMBRELLA_PAGES) if (matches(`${p.label} ${p.words}`)) hits.push({ href: p.path(umbrella.id, umbrella.hubKey), label: p.label, sub: umbrella.name });
  for (const u of everywhere)
    for (const p of UMBRELLA_PAGES) if (matches(`${p.label} ${p.words} ${u.name}`)) hits.push({ href: p.path(u.id, u.hubKey), label: `${u.name} · ${p.path(u.id, u.hubKey).includes("/settings#") ? `Settings → ${p.label}` : p.label}`, sub: u.name });
  for (const p of ACCOUNT_PAGES) if (matches(`${p.label} ${p.words} account`)) hits.push({ href: `/account#${p.anchor}`, label: p.label, sub: "Your account" });
  if (matches("umbrellas home all projects")) hits.push({ href: "/", label: "Umbrellas", sub: "Every umbrella and test cycle" });
  if (matches("rc status release end of day")) hits.push({ href: "/rc", label: "Release status", sub: "Across every umbrella" });
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
    const q = raw.trim();
    const { group, projects } = await scopeOf(user, groupId, archived);
    const hub = group ? projects.find((p) => p.id === group.hubProjectId) : null;
    const umbrella = group && hub ? { id: group.id, name: group.name, hubKey: hub.key } : null;
    const groups: SearchGroup[] = [];
    if (!q) return { groups, umbrella };
    const ids = projects.map((p) => p.id);
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
    if (caseRows.length) {
      const cases = await db.testCase.findMany({
        where: { id: { in: caseRows.map((r) => r.id) } },
        include: { project: { select: { key: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { steps: true, folderPath: true } } },
      });
      const order = new Map(caseRows.map((r, i) => [r.id, i]));
      cases.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      const seeAllProject = hub ?? (projects.length === 1 ? projects[0] : null);
      groups.push({
        kind: "cases",
        total: Number(caseRows[0].total),
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
    // "R1" finds every test cycle's R1, each named with its test cycle (ver_89).
    const runNumber = /^R(\d+)$/i.exec(q);
    const runWhere: Prisma.TestRunWhereInput = {
      projectId: { in: ids },
      OR: [{ name: { contains: q, mode: "insensitive" } }, { release: { contains: q, mode: "insensitive" } }, { build: { contains: q, mode: "insensitive" } }, ...(runNumber ? [{ number: Number(runNumber[1]) }] : [])],
    };
    const [runTotal, runs] = await Promise.all([
      db.testRun.count({ where: runWhere }),
      db.testRun.findMany({ where: runWhere, orderBy: { createdAt: "desc" }, take: PER_GROUP, include: { project: { select: { key: true } }, entries: { select: { status: true } } } }),
    ]);
    if (runTotal)
      groups.push({
        kind: "runs",
        total: runTotal,
        seeAll: group ? `/g/${group.id}/runs` : undefined,
        hits: runs.map((r) => {
          const done = r.entries.filter((e) => !["UNTESTED", "RETEST", "IN_PROGRESS"].includes(e.status)).length;
          return {
            href: `/p/${r.project.key}/runs/${r.number}`,
            key: `R${r.number}`,
            label: r.name,
            best: !!runNumber && r.number === Number(runNumber[1]),
            sub: [placeOf(r.projectId), r.release && `Release ${r.release}`, r.automated ? "🤖 Automated" : `${r.entries.length ? Math.round((done / r.entries.length) * 100) : 0}% done`, r.state === "ACTIVE" ? "Active" : "Closed"].filter(Boolean).join(" · "),
          };
        }),
      });

    // Bugs: Jira key, title.
    const bugWhere: Prisma.DefectWhereInput = { projectId: { in: ids }, OR: [{ title: { contains: q, mode: "insensitive" } }, { externalKey: { contains: q, mode: "insensitive" } }] };
    const [bugTotal, bugs] = await Promise.all([
      db.defect.count({ where: bugWhere }),
      db.defect.findMany({ where: bugWhere, orderBy: { createdAt: "desc" }, take: 20, include: { project: { select: { key: true, groupId: true } } } }),
    ]);
    if (bugTotal) {
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
    const cycles = projects
      .filter((p) => !p.hubOf && [p.name, p.rcName, p.platform, p.key].some((t) => t.toLowerCase().includes(needle)))
      .map((p) => ({ href: `/p/${p.key}`, label: p.name, sub: ["Test cycle", p.group?.hubProjectId && !group ? p.group.name : null].filter(Boolean).join(" · "), archived: !!p.archivedAt }));
    const cycleHits = [...umbrellas, ...cycles];
    if (cycleHits.length) groups.push({ kind: "cycles", total: cycleHits.length, hits: cycleHits.slice(0, PER_GROUP), seeAll: group && cycles.length > PER_GROUP ? `/g/${group.id}/projects` : undefined });

    // Suites and shared steps: name.
    const [suites, shared] = await Promise.all([
      db.testSuite.findMany({ where: { projectId: { in: ids }, name: { contains: q, mode: "insensitive" }, ...(archived ? {} : { archived: false }) }, take: 20, include: { project: { select: { key: true } }, _count: { select: { cases: true } } } }),
      db.sharedStep.findMany({ where: { projectId: { in: ids }, name: { contains: q, mode: "insensitive" }, ...(archived ? {} : { archived: false }) }, take: 20, include: { project: { select: { key: true } }, _count: { select: { usages: true } } } }),
    ]);
    const libHits: SearchHit[] = [
      ...suites.map((s) => ({ href: `/p/${s.project.key}/suites/${s.id}`, label: s.name, sub: [`Suite v${s.currentVersion}`, `${s._count.cases} ${s._count.cases === 1 ? "case" : "cases"}`, placeOf(s.projectId)].join(" · "), archived: s.archived })),
      ...shared.map((s) => ({ href: `/p/${s.project.key}/shared-steps/${s.id}`, label: s.name, sub: [`Shared step v${s.currentVersion}`, `used by ${s._count.usages} ${s._count.usages === 1 ? "case" : "cases"}`, placeOf(s.projectId)].join(" · "), archived: s.archived })),
    ];
    if (libHits.length) groups.push({ kind: "suites", total: libHits.length, hits: libHits.slice(0, PER_GROUP) });

    const everywhere = group ? [] : [...new Map(projects.filter((p) => p.hubOf).map((p) => [p.hubOf!.id, { id: p.hubOf!.id, name: p.hubOf!.name, hubKey: p.key }])).values()];
    const pages = pageHits(q, umbrella, everywhere);
    if (pages.length) groups.push({ kind: "pages", total: pages.length, hits: pages.slice(0, PER_GROUP) });

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
    const goTo: SearchHit[] = group && hub ? UMBRELLA_PAGES.slice(0, 7).map((p) => ({ href: p.path(group.id, hub.key), label: p.label, sub: group.name })) : [];
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
