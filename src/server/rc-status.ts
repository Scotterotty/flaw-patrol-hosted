import { countsForRelease } from "@/lib/run-kinds";
import "server-only";
import { stillBrokenByPlatform } from "@/lib/regression-data";

import { pickValues } from "@/lib/run-fields";
import { runFieldsFor } from "@/lib/run-fields-server";
import type { ResultStatus, Severity } from "@prisma/client";
import { db } from "@/lib/db";
import { DONE, releaseKey, type RcBug, type RcColumn, type RcPick, type RcRunChoice } from "@/lib/rc-status";
import { isSevere, SEVERITIES, type SeverityScale } from "@/lib/severity";
import { severityScaleFor } from "@/lib/severity-server";
import { parsePlatforms } from "@/lib/umbrella";

type Viewer = { id: string; isAdmin: boolean };

const projectScope = (user: Viewer) => (user.isAdmin ? {} : { project: { members: { some: { userId: user.id } } } });

/**
 * Which runs a report starts from. An umbrella's report only ever shows its own projects' runs;
 * a project's report starts with its own runs but can add runs from anywhere.
 */
export type RcScope = { projectIds: string[]; addAnywhere: boolean };

/** Every release on a run in the viewer's projects (or just the scope's), newest first, spelled as on the newest run. */
export async function listReleases(user: Viewer, scope?: RcScope) {
  const runs = await db.testRun.findMany({
    where: { release: { not: "" }, ...projectScope(user), ...(scope && { projectId: { in: scope.projectIds } }) },
    select: { release: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Map<string, string>();
  for (const r of runs) if (!seen.has(releaseKey(r.release))) seen.set(releaseKey(r.release), r.release.trim());
  return [...seen.values()];
}

// Words that name the client being tested, looked for in the run, then its project.
const CLIENTS = ["Unity", "Unreal", "Web", "iOS", "Android", "Mac", "Windows", "Quest", "Desktop", "Mobile"];
function clientOf(...texts: string[]) {
  for (const text of texts) {
    const hit = CLIENTS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
    if (hit) return hit;
  }
  return null;
}

/** The column a run adds up in: its test cycle's platform, else the client its names mention. */
function columnLabel(run: { name: string; environment: string; project: { name: string; platform: string } }, platforms: string[]) {
  const p = run.project.platform;
  const platform = platforms.find((x) => x.toLowerCase() === p.trim().toLowerCase()) ?? p.trim();
  return platform || clientOf(run.name, run.environment, run.project.name) || run.environment || run.name;
}

/**
 * The umbrella card's release line, such as "RC 22 · 1 of 3 done" (ver_100). The same columns
 * as the umbrella's Release status report with nothing ticked or unticked, but only counted:
 * no bugs, automation or regressions, so the Umbrellas page doesn't run the whole report.
 */
export async function rcGlanceLine(projectIds: string[], platforms: string[]) {
  const [newest, fetched] = await Promise.all([
    db.testRun.findFirst({ where: { release: { not: "" }, projectId: { in: projectIds } }, select: { release: true }, orderBy: { createdAt: "desc" } }),
    db.testRun.findMany({
      where: { automated: false, projectId: { in: projectIds } },
      select: { id: true, name: true, release: true, kind: true, environment: true, project: { select: { name: true, platform: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  const latest = newest?.release.trim();
  if (!latest) return "No releases yet";
  const key = releaseKey(latest);
  const marked = fetched.filter((r) => r.release && releaseKey(r.release) === key && countsForRelease(r.kind));
  const ids = marked.map((r) => r.id);
  const [bashes, counts] = await Promise.all([
    db.bugBash.findMany({ where: { runId: { in: fetched.map((r) => r.id) } }, select: { runId: true } }),
    db.runEntry.groupBy({ by: ["runId", "status"], where: { runId: { in: ids } }, _count: { _all: true } }),
  ]);
  // Bug bashes stay out, as on the report with Include bug bashes off.
  const bashIds = new Set(bashes.map((b) => b.runId));
  const runs = marked.filter((r) => !bashIds.has(r.id));
  const label = new Map(runs.map((r) => [r.id, columnLabel(r, platforms)]));
  const columns = new Map<string, { total: number; done: number }>([...new Set([...label.values(), ...platforms])].map((l) => [l, { total: 0, done: 0 }]));
  for (const c of counts) {
    const col = label.has(c.runId) ? columns.get(label.get(c.runId)!) : undefined;
    if (!col) continue;
    col.total += c._count._all;
    if (DONE.includes(c.status)) col.done += c._count._all;
  }
  const done = [...columns.values()].filter((c) => c.total > 0 && c.done === c.total).length;
  return `${latest} · ${done} of ${columns.size} done`;
}

/**
 * One column per run marked with this release, from every project the viewer is in,
 * less any they untick, plus any other runs they add.
 */
export async function rcStatus(
  user: Viewer,
  release: string,
  pick: RcPick,
  scope?: RcScope,
): Promise<{ columns: RcColumn[]; bugs: RcBug[]; choices: RcRunChoice[]; others: RcRunChoice[]; scale: SeverityScale; bashCount: number }> {
  const key = releaseKey(release);
  const fetched = await db.testRun.findMany({
    // Automation uploads aren't columns: they're each client's Automation line (ver_82).
    where: { automated: false, ...projectScope(user), ...(scope && !scope.addAnywhere && { projectId: { in: scope.projectIds } }) },
    select: { id: true, number: true, name: true, release: true, createdAt: true, projectId: true, kind: true, project: { select: { key: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  // Only the scope's own runs are listed until someone adds another.
  const all = fetched.filter((r) => !scope || scope.projectIds.includes(r.projectId) || pick.add.includes(r.id));
  const extra = fetched.filter((r) => !all.includes(r));
  const choice = (r: (typeof all)[number]): RcRunChoice => ({
    id: r.id,
    name: r.name,
    project: r.project.name,
    projectKey: r.project.key,
    number: r.number,
    release: r.release.trim(),
    on: r.release && releaseKey(r.release) === key && countsForRelease(r.kind) ? !pick.hide.includes(r.id) : pick.add.includes(r.id),
  });
  // Bug bashes stay out of releases (ver_94). A bash counts toward this release when its run is
  // marked with it, or when it wasn't attached to a test cycle and ran while this release was on.
  const bashIds = new Set((await db.bugBash.findMany({ where: { runId: { in: fetched.map((r) => r.id) } }, select: { runId: true } })).map((b) => b.runId!));
  const plain = all.filter((r) => !bashIds.has(r.id));
  // Smoke tests and custom kinds stay out unless added by hand (ver_95); release candidates and plain runs count.
  const mine = plain.filter((r) => r.release && releaseKey(r.release) === key && countsForRelease(r.kind));
  const from = Math.min(...mine.map((r) => r.createdAt.getTime()));
  const until = Math.min(...plain.filter((r) => r.release && releaseKey(r.release) !== key && r.createdAt.getTime() > from).map((r) => r.createdAt.getTime()));
  const bashRuns = all.filter((r) => bashIds.has(r.id) && (r.release ? releaseKey(r.release) === key : r.createdAt.getTime() >= from && r.createdAt.getTime() < until));
  const marked = mine;
  const choices = [...marked, ...plain.filter((r) => pick.add.includes(r.id) && !marked.includes(r))].map(choice);
  const others = [...plain, ...extra.filter((r) => !bashIds.has(r.id))].filter((r) => !choices.some((c) => c.id === r.id)).map(choice);
  const ids = [...choices.filter((c) => c.on).map((c) => c.id), ...(pick.bashes ? bashRuns.map((r) => r.id) : [])];
  const bashCount = bashRuns.length;
  // The team's severity names (ver_91): the scope's Jira, or the first run's.
  // Every current platform of the umbrella gets a column (ver_94), even before anyone tests it.
  // Only an umbrella's own report (its scope holds the hub), not one test cycle's. Fetched together (ver_120).
  const [scale, hub] = await Promise.all([
    severityScaleFor(scope?.projectIds[0] ?? all.find((r) => ids.includes(r.id))?.projectId),
    scope ? db.project.findFirst({ where: { id: { in: scope.projectIds }, hubOf: { isNot: null } }, select: { hubOf: { select: { platforms: true } } } }) : null,
  ]);
  const platforms = parsePlatforms(hub?.hubOf?.platforms).map((p) => p.name);
  if (ids.length === 0 && platforms.length === 0 && bashCount === 0) return { columns: [], bugs: [], choices, others, scale, bashCount };

  // Serious bugs from bug bashes always make the bug list, switch or not (Scott, ver_94).
  const bashOnly = pick.bashes ? [] : bashRuns.map((r) => r.id);
  const [runs, links] = await Promise.all([
    db.testRun.findMany({
      where: { id: { in: ids } },
      include: {
        project: { select: { key: true, name: true, platform: true, groupId: true } },
        entries: { select: { id: true, status: true, lastTestedAt: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    }),
    db.defectLink.findMany({
      where: { result: { runId: { in: [...ids, ...bashOnly] } } },
      select: {
        defect: { select: { id: true, number: true, title: true, severity: true, status: true, externalPriority: true, externalKey: true, externalUrl: true, externalStatus: true, project: { select: { key: true } } } },
        result: { select: { runId: true, entryId: true, entry: { select: { status: true } } } },
      },
    }),
  ]);
  // Run fields, automation uploads and still-broken regressions don't depend on each other (ver_120).
  const groups = [...new Set(runs.map((r) => r.project.groupId).filter((g): g is string => !!g))];
  const wideIds = groups.length ? db.project.findMany({ where: { groupId: { in: groups } }, select: { id: true } }).then((ps) => ps.map((p) => p.id)) : Promise.resolve([...new Set(runs.map((r) => r.projectId))]);
  const [defsList, uploads, broken] = await Promise.all([
    Promise.all([...new Set(runs.map((r) => r.projectId))].map(async (id) => [id, await runFieldsFor(id)] as const)),
    // Each client's latest automation upload for this release, from the same test cycle.
    db.testRun.findMany({
      where: { automated: true, projectId: { in: [...new Set([...runs.map((r) => r.projectId), ...(platforms.length && scope ? scope.projectIds : [])])] } },
      orderBy: { createdAt: "desc" },
      select: { projectId: true, number: true, release: true, build: true, project: { select: { key: true, platform: true } }, entries: { select: { status: true } } },
    }),
    wideIds.then((wide) => stillBrokenByPlatform(wide, release)),
  ]);

  // One column per client: two runs on the same client (a suite run and an exploratory
  // session, say) add up in one column, with their names listed under it (ver_86).
  const perRun = runs.map((run) => ({ run, label: bashIds.has(run.id) ? "Bug bash" : columnLabel(run, platforms) }));
  const labels = [...new Set([...perRun.map((r) => r.label), ...platforms])];
  // Run fields ticked "Show on Release status cards" (ver_89), per test cycle.
  const defsOf = new Map(defsList);
  const columns: RcColumn[] = labels.map((label) => {
    const mine = perRun.filter((r) => r.label === label).map((r) => r.run);
    // A platform nobody has run yet: NOT STARTED, with its automation line if any.
    if (!mine.length)
      return { id: `platform:${label}`, runIds: [], href: "", label, runName: "No manual run yet", runs: [], build: "", extra: "", completed: false, total: 0, done: 0, counts: {}, testedAt: [], severities: {}, platform: label };
    const ids = new Set(mine.map((r) => r.id));
    const entries = mine.flatMap((r) => r.entries);
    const counts: Partial<Record<ResultStatus, number>> = {};
    for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
    const done = entries.filter((e) => DONE.includes(e.status));
    // Each bug counts once per column, however many results it's linked to.
    const bugs = new Map<string, Severity>();
    for (const l of links) if (ids.has(l.result.runId)) bugs.set(l.defect.id, l.defect.severity);
    const severities: Partial<Record<Severity, number>> = {};
    for (const s of bugs.values()) severities[s] = (severities[s] ?? 0) + 1;
    // The newest run's build and CSP stand for the column.
    const newest = mine[mine.length - 1];
    return {
      id: mine[0].id,
      runIds: mine.map((r) => r.id),
      href: `/p/${mine[0].project.key}/runs/${mine[0].number}`,
      label,
      runName: mine.map((r) => `${r.name} · ${r.project.key}`).join(", "),
      runs: mine.length > 1 ? mine.map((r) => ({ name: r.name, href: `/p/${r.project.key}/runs/${r.number}` })) : [],
      build: newest.build,
      extra: pickValues(newest, defsOf.get(newest.projectId) ?? [], "rc").map((v) => (v.id === "csp" ? `CSP ${v.value}` : `${v.name} ${v.value}`)).join(" · "),
      completed: mine.every((r) => r.state === "COMPLETED"),
      total: entries.length,
      done: done.length,
      counts,
      testedAt: done.map((e) => e.lastTestedAt?.getTime() ?? 0),
      severities,
      bash: label === "Bug bash",
    };
  });

  for (const col of columns) {
    if (col.bash) continue;
    const projects = new Set(runs.filter((r) => col.runIds.includes(r.id)).map((r) => r.projectId));
    const up = uploads.find((u) => (projects.has(u.projectId) || (!!col.platform && u.project.platform.trim().toLowerCase() === col.platform.toLowerCase())) && releaseKey(u.release) === key);
    col.automation = up ? { passed: up.entries.filter((e) => e.status === "PASSED").length, total: up.entries.length, build: up.build, href: `/p/${up.project.key}/runs/${up.number}` } : null;
  }

  // Regression flag (ver_93): regressions in this release still broken, per platform.
  for (const col of columns) {
    const plats = new Set([...runs.filter((r) => col.runIds.includes(r.id)).map((r) => r.project.platform.trim().toLowerCase()), ...(col.platform ? [col.platform.toLowerCase()] : [])]);
    const rows = [...plats].flatMap((p) => broken.get(p) ?? []);
    col.regressions = rows.length ? { count: rows.length, keys: rows.map((r) => `${r.caseKey}${r.automated ? " 🤖" : ""}`) } : null;
  }

  // Alphabetical, as in the end-of-day report: Unity, Unreal, Web. The Bug bash column goes last.
  columns.sort((a, b) => Number(!!a.bash) - Number(!!b.bash) || a.label.localeCompare(b.label));

  // Bugs worth a line of their own: showstoppers and criticals, Jira Blockers, and any that blocked a case.
  const byDefect = new Map<string, RcBug>();
  const label = new Map(columns.flatMap((c) => c.runIds.map((id) => [id, c.label] as const)));
  for (const id of bashOnly) label.set(id, "Bug bash");
  for (const l of links) {
    const d = l.defect;
    const blocked = l.result.entry.status === "BLOCKED";
    const fromBash = bashIds.has(l.result.runId);
    if (!isSevere(d.severity, scale) && !/^blocker$/i.test(d.externalPriority ?? "") && !blocked) continue;
    // With Include bug bashes off, only bash bugs at a critical severity make the list.
    if (fromBash && !pick.bashes && !isSevere(d.severity, scale)) continue;
    const bug = byDefect.get(d.id) ?? {
      id: d.id,
      key: d.externalKey ?? `${d.project.key}-D${d.number}`,
      url: d.externalUrl,
      title: d.title,
      severity: d.severity,
      priority: d.externalPriority ?? "",
      status: d.externalStatus ?? (d.status === "OPEN" ? "Open" : d.status.charAt(0) + d.status.slice(1).toLowerCase()),
      clients: [],
      cases: [],
      fromBash,
    };
    const client = label.get(l.result.runId)!;
    if (!bug.clients.includes(client)) bug.clients.push(client);
    if (!bug.cases.includes(l.result.entryId)) bug.cases.push(l.result.entryId);
    byDefect.set(d.id, bug);
  }
  const bugs = [...byDefect.values()].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.cases.length - a.cases.length);
  return { columns, bugs, choices, others, scale, bashCount };
}
