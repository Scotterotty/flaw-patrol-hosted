import "server-only";
import type { ResultStatus } from "@prisma/client";
import { db } from "./db";
import { caseKey } from "./format";
import { jiraFor } from "./jira";
import { releaseKey } from "./rc-status";
import { isOpen } from "./status";
import { mergeReleases } from "./stories-config";
import { isEpic, rememberStories, requirementProjects, storiesConfigFor, storyInfo, type StoryInfo } from "./stories";
import { OPEN_BUG } from "./umbrella";

// Requirement coverage ("stories" until ver_89): for each Jira requirement, the cases that
// test it and how they did in each test cycle. Used by the Requirements page and the Reports tab.

export type CoverageColumn = { id: string; key: string; name: string };
export type CoverageCell = { text: string; tone: "pass" | "fail" | "run" | "none" };
export type CoverageCase = { id: string; key: string; href: string; title: string; results: (ResultStatus | null)[]; charter: boolean; needsSteps: boolean };
export type CoverageState = "none" | "failing" | "notrun" | "passing";
export type CoverageRow = {
  story: StoryInfo;
  cases: CoverageCase[];
  cells: CoverageCell[];
  /** All columns together: each case's newest result in any of them. */
  overall: CoverageCell;
  state: CoverageState;
  bugs: { key: string; url: string | null; title: string }[];
  /** An Epic with the roll-up on: its child issues, whose cases it also counts. */
  children?: CoverageRow[];
};

const FAILISH: ResultStatus[] = ["FAILED", "BLOCKED"];

function cellOf(statuses: (ResultStatus | null)[]): CoverageCell {
  const ran = statuses.filter((s): s is ResultStatus => !!s && !isOpen(s));
  if (!statuses.length) return { text: "No cases", tone: "none" };
  if (!ran.length) return { text: "Not run", tone: "none" };
  const failed = ran.filter((s) => FAILISH.includes(s)).length;
  if (failed) return { text: `${failed} failed`, tone: "fail" };
  const passed = ran.filter((s) => s === "PASSED").length;
  if (passed === statuses.length) return { text: `${passed}/${statuses.length} passed`, tone: "pass" };
  return { text: `${ran.length}/${statuses.length} run`, tone: "run" };
}

/**
 * Coverage of the stories in a Jira release, or in any of several (or every linked story when release is null),
 * by the cases in `libraryIds`, with one column per test cycle in `columns`.
 * `release` also limits results to runs of that release (those releases) unless `latestAnywhere`.
 */
export async function storyCoverage(opts: {
  projectId: string;
  libraryIds: string[];
  columns: CoverageColumn[];
  release: string | string[] | null;
  latestAnywhere?: boolean;
  /** No release: list every requirement Jira has in the requirement projects too, not only ones a case links (Requirements page, ver_161). */
  everything?: boolean;
}) {
  const { projectId, libraryIds, columns } = opts;
  const releases = opts.release == null ? [] : (Array.isArray(opts.release) ? opts.release : [opts.release]).filter(Boolean);
  const release = releases.length ? releases : null;
  const setup = await storiesConfigFor(projectId);
  const cases = await db.testCase.findMany({
    where: { projectId: { in: libraryIds }, archived: false, NOT: { jiraStories: { isEmpty: true } } },
    select: { id: true, number: true, title: true, jiraStories: true, type: true, flag: true, project: { select: { key: true } } },
    orderBy: [{ projectId: "asc" }, { number: "asc" }],
  });
  let inRelease: StoryInfo[] | null = null;
  let jiraError: string | null = null;
  if (setup && (release || opts.everything)) {
    try {
      const client = await jiraFor(projectId);
      inRelease = (release ? await client!.storiesInRelease(setup.config, release) : await client!.allStories(setup.config)).map((i) => ({ key: i.key, title: i.summary, status: i.status, category: i.category, url: i.url, type: i.type, parent: i.parent, priority: i.priority, points: i.points ?? null, releases: i.releases ?? [] }));
    } catch (e) {
      jiraError = e instanceof Error ? e.message : "Couldn't reach Jira.";
    }
  }
  const linkedKeys = [...new Set(cases.flatMap((c) => c.jiraStories))];
  // A release lists its requirements only; Any release lists Jira's and every linked one.
  const keys = inRelease ? (release ? inRelease.map((s) => s.key) : [...new Set([...inRelease.map((s) => s.key), ...linkedKeys])]) : linkedKeys;
  const info = await storyInfo(projectId, inRelease ? linkedKeys.filter((k) => !inRelease!.some((s) => s.key === k)) : keys);
  for (const s of inRelease ?? []) info.set(s.key, s);

  // Latest result per case in each column's runs (of the release, unless latest anywhere).
  const caseIds = cases.map((c) => c.id);
  const relKeys = release ? new Set(release.map(releaseKey)) : null;
  const entries = caseIds.length
    ? await db.runEntry.findMany({
        where: { caseId: { in: caseIds }, run: { projectId: { in: columns.map((c) => c.id) } } },
        select: { caseId: true, status: true, lastTestedAt: true, run: { select: { projectId: true, release: true, createdAt: true } } },
        orderBy: { run: { createdAt: "desc" } },
      })
    : [];
  const latest = new Map<string, ResultStatus>();
  const newest = new Map<string, ResultStatus>();
  for (const e of entries) {
    if (relKeys && !opts.latestAnywhere && !relKeys.has(releaseKey(e.run.release))) continue;
    const k = `${e.run.projectId}:${e.caseId}`;
    if (!latest.has(k)) latest.set(k, e.status);
    // Overall: the newest finished result anywhere, so a fresh untested run doesn't hide it.
    const cur = newest.get(e.caseId);
    if (cur === undefined || (isOpen(cur) && !isOpen(e.status))) newest.set(e.caseId, e.status);
  }
  const bugLinks = caseIds.length
    ? await db.defectLink.findMany({
        where: { result: { caseId: { in: caseIds }, run: { projectId: { in: columns.map((c) => c.id) } } }, defect: OPEN_BUG },
        select: { result: { select: { caseId: true } }, defect: { select: { id: true, externalKey: true, externalUrl: true, number: true, title: true, project: { select: { key: true } } } } },
      })
    : [];

  // One row: the cases linked to `key` (and to `also`, an Epic's children when it rolls up).
  const rowFor = (key: string, also: string[] = []): CoverageRow => {
    const linked = new Set([key, ...also]);
    const mine = cases.filter((c) => c.jiraStories.some((k) => linked.has(k)));
    const list: CoverageCase[] = mine.map((c) => ({
      id: c.id,
      key: caseKey(c.project.key, c.number),
      href: `/p/${c.project.key}/cases/${c.number}`,
      title: c.title,
      results: columns.map((col) => latest.get(`${col.id}:${c.id}`) ?? null),
      charter: c.type === "EXPLORATORY",
      needsSteps: c.flag === "NEEDS_STEPS",
    }));
    const cells = columns.map((_, i) => cellOf(list.map((c) => c.results[i])));
    const overall = cellOf(mine.map((c) => newest.get(c.id) ?? null));
    const all = list.flatMap((c) => c.results).filter((s): s is ResultStatus => !!s && !isOpen(s));
    const state: CoverageState = !list.length ? "none" : all.some((s) => FAILISH.includes(s)) ? "failing" : !all.length ? "notrun" : "passing";
    const ids = new Set(mine.map((c) => c.id));
    const bugs = [...new Map(bugLinks.filter((l) => ids.has(l.result.caseId)).map((l) => [l.defect.id, l.defect])).values()].map((d) => ({ key: d.externalKey ?? `${d.project.key}-D${d.number}`, url: d.externalUrl, title: d.title }));
    return { story: info.get(key) ?? { key, title: "", status: "", category: "", url: null }, cases: list, cells, overall, state, bugs };
  };

  // Epic roll-up: an Epic also counts its child issues' cases, one level down, and lists them under it.
  const childrenByEpic = new Map<string, string[]>();
  if (setup?.config.rollUp) {
    const epics = keys.filter((k) => isEpic(info.get(k)?.type));
    if (epics.length) {
      try {
        const client = await jiraFor(projectId);
        const kids = await client!.childrenOf(epics);
        rememberStories(kids);
        for (const k of kids) {
          if (!k.parent) continue;
          info.set(k.key, { key: k.key, title: k.summary, status: k.status, category: k.category, url: k.url, type: k.type, parent: k.parent });
          childrenByEpic.set(k.parent, [...(childrenByEpic.get(k.parent) ?? []), k.key]);
        }
      } catch (e) {
        jiraError ??= e instanceof Error ? e.message : "Couldn't reach Jira.";
      }
    }
  }
  const nested = new Set([...childrenByEpic.values()].flat());
  const rows: CoverageRow[] = keys
    .filter((key) => !nested.has(key))
    .map((key) => {
      const kids = childrenByEpic.get(key);
      if (!kids) return rowFor(key);
      return { ...rowFor(key, kids), children: kids.map((k) => rowFor(k)) };
    });
  const counts = { all: rows.length, none: 0, failing: 0, notrun: 0, passing: 0 } as Record<"all" | CoverageState, number>;
  for (const r of rows) counts[r.state]++;
  const types = [...new Set(rows.flatMap((r) => [r.story.type, ...(r.children ?? []).map((c) => c.story.type)]).filter((t): t is string => !!t))].sort();
  return { rows, counts, types, jiraError, connected: !!setup, config: setup?.config ?? null, bugProject: setup?.bugProject ?? null };
}

/**
 * Releases (fixVersions) of the requirement projects, for the release picker. With several projects,
 * their lists are merged newest first, taking turns, and a name two projects share shows once.
 */
export async function storyReleases(projectId: string) {
  const setup = await storiesConfigFor(projectId);
  if (!setup) return [];
  const keys = requirementProjects(setup.config, setup.bugProject);
  if (!keys?.length) return [];
  try {
    const client = await jiraFor(projectId);
    const lists = await Promise.all(keys.map((k) => client!.versions(k).catch(() => [] as string[])));
    return mergeReleases(lists);
  } catch {
    return [];
  }
}

/**
 * The RC names the newest test cycles are testing: each cycle's RC name, or failing that the
 * release on its newest run. The Stories report opens on the Jira release with one of these names.
 */
/** The Jira release the current test cycles are testing, matched loosely ("RC 22" = "rc22"), else Jira's newest. */
export function testedRelease(releases: string[], rcNames: string[]) {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return releases.find((r) => rcNames.some((n) => key(n) === key(r))) ?? releases[0] ?? null;
}

export async function newestRcNames(cycles: { id: string; rcName: string }[]) {
  const named = cycles.map((c) => c.rcName.trim()).filter(Boolean);
  if (named.length) return named;
  const run = await db.testRun.findFirst({ where: { projectId: { in: cycles.map((c) => c.id) }, release: { not: "" } }, orderBy: { createdAt: "desc" }, select: { release: true } });
  return run ? [run.release.trim()] : [];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The coverage table as HTML Confluence keeps when pasted. */
export function coverageHtml(title: string, columns: CoverageColumn[], rows: CoverageRow[]) {
  const head = `<tr><th>Requirement</th>${columns.map((c) => `<th>${esc(c.name)}</th>`).join("")}<th>Open bugs</th></tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr><td>${r.story.url ? `<a href="${esc(r.story.url)}">${esc(r.story.key)}</a>` : esc(r.story.key)} ${esc(r.story.title)}</td>${r.cells
          .map((c) => `<td>${c.tone === "fail" ? `<span style="color:#B10202"><strong>${esc(c.text)}</strong></span>` : esc(c.text)}</td>`)
          .join("")}<td>${r.bugs.length ? r.bugs.map((b) => (b.url ? `<a href="${esc(b.url)}">${esc(b.key)}</a>` : esc(b.key))).join(", ") : "None"}</td></tr>`,
    )
    .join("\n");
  return `<h2>${esc(title)}</h2>\n<table><tbody>${head}\n${body}</tbody></table>`;
}

/** The coverage table as rows, header first (CSV, Excel and PDF exports). */
export function coverageCsvRows(columns: CoverageColumn[], rows: CoverageRow[]): string[][] {
  return [
    ["Requirement", "Type", "Title", "Jira status", "Cases", ...columns.map((c) => c.name), "Open bugs"],
    ...rows.map((r) => [r.story.key, r.story.type ?? "", r.story.title, r.story.status, String(r.cases.length), ...r.cells.map((c) => c.text), r.bugs.map((b) => b.key).join(" ")]),
  ];
}

export function coverageCsv(columns: CoverageColumn[], rows: CoverageRow[]) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return coverageCsvRows(columns, rows)
    .map((r) => r.map(q).join(","))
    .join("\n");
}
