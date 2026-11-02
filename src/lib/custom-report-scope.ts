import "server-only";
import { db } from "./db";
import { can, type Who } from "./permissions";
import { regressionScope } from "./regression-data";
import { hadPeoplePart, parseItems } from "./report-parts";
import { releaseOptions, type ReportFilters } from "./reports";
import { dateRange } from "./spelling";
import { newestRcNames } from "./story-coverage";
import { libraryProjectIds, loadUmbrella } from "./umbrella";
import { filterWords, type CustomScope } from "./custom-report-data";

// Custom reports (ver_101): the scope of a test cycle's or an umbrella's Custom reports tab.

type Viewer = { id: string; isAdmin: boolean; name?: string | null; email: string };
type Cycle = { id: string; key: string; name: string; groupId: string | null; platform: string; rcName: string };

const when = (f: ReportFilters) => (f.runNumber ? `Run R${f.runNumber}` : f.release ? `Release ${f.release}` : f.allTime ? "All time" : dateRange(f.from, f.to, "us"));

export async function cycleScope(project: Cycle, user: Viewer): Promise<CustomScope> {
  const [library, regressionIds, rcNames] = await Promise.all([libraryProjectIds(project), regressionScope(project), newestRcNames([project])]);
  const cs: CustomScope = {
    umbrella: false,
    homeId: project.id,
    homeKey: project.key,
    allIds: [project.id],
    scope: project.id,
    library,
    regressionIds,
    regressionPlatform: project.platform || undefined,
    reportsBase: `/p/${project.key}/reports`,
    title: project.name,
    exportCtx: (f, q) => ({
      scope: project.id,
      homeId: project.id,
      umbrella: false,
      title: project.name,
      filters: filterWords(cs, q, when(f)),
      viewer: { id: user.id, isAdmin: user.isAdmin },
      coverage: { libraryIds: library, columns: [{ id: project.id, key: project.key, name: project.name }], rcNames },
      projectKey: project.key,
      query: q,
    }),
  };
  return cs;
}

export type Umbrella = NonNullable<Awaited<ReturnType<typeof loadUmbrella>>>;

/** `platform`: the report's Platform filter, which narrows the runs counted. */
export async function umbrellaScope(u: Umbrella, user: Viewer, platform: string): Promise<CustomScope> {
  const all = [u.hub.id, ...u.projects.map((p) => p.id)];
  const p = platform.toLowerCase();
  const scope = p ? u.projects.filter((x) => x.platform.toLowerCase() === p).map((x) => x.id) : all;
  const rcNames = await newestRcNames(u.current);
  const platformName = p ? u.platforms.find((x) => x.name.toLowerCase() === p)?.name ?? platform : undefined;
  const cs: CustomScope = {
    umbrella: true,
    homeId: u.hub.id,
    homeKey: u.hub.key,
    allIds: all,
    scope: scope.length ? scope : ["-"],
    library: [u.hub.id],
    regressionIds: all,
    regressionPlatform: platformName,
    reportsBase: `/g/${u.group.id}/reports`,
    title: u.group.name,
    exportCtx: (f, q) => ({
      scope: scope.length ? scope : ["-"],
      homeId: u.hub.id,
      umbrella: true,
      title: u.group.name,
      filters: filterWords(cs, q, when(f)),
      viewer: { id: user.id, isAdmin: user.isAdmin },
      coverage: { libraryIds: [u.hub.id], columns: u.current.map((x) => ({ id: x.id, key: x.key, name: x.name })), rcNames },
      query: q,
    }),
  };
  return cs;
}

/** The reports someone can see here, and which of them they may change. */
export async function reportsFor(homeId: string, user: Viewer, who: Who) {
  const rows = await db.customReport.findMany({ where: { projectId: homeId, OR: [{ shared: true }, { createdById: user.id }] }, orderBy: { updatedAt: "desc" } });
  return rows.map((r) => ({
    ...r,
    items: parseItems(r.parts),
    removedPeople: hadPeoplePart(r.parts),
    canEdit: can(who, "run:execute") && (r.createdById === user.id || (r.shared && can(who, "run:manage"))),
    canDelete: can(who, "run:execute") && (r.createdById === user.id || (r.shared && who.role === "ADMIN")),
  }));
}
export type ReportRow = Awaited<ReturnType<typeof reportsFor>>[number];

/** For + Add to report: the reports this person can add to. */
export async function addTargets(homeId: string, user: Viewer, who: Who) {
  if (!can(who, "run:execute")) return null;
  const rows = await reportsFor(homeId, user, who);
  return rows.filter((r) => r.canEdit).map((r) => ({ id: r.id, name: r.name, parts: r.items.filter((i) => i.k === "part").length, shared: r.shared }));
}

export const releasesFor = (cs: CustomScope) => releaseOptions(cs.allIds);
