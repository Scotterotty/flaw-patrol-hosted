import { type GroupChoice } from "@/components/group-dialogs";
import { ProjectsBrowser } from "@/components/projects-browser";
import { cookies } from "next/headers";
import { parseUmbrellaSort, UMBRELLA_SORT_COOKIE } from "@/lib/project-list";
import { TopBar } from "@/components/top-bar";
import { EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { startTiming } from "@/lib/timing";
import { umbrellaCards } from "@/lib/umbrella-cards";
import { canMakeUmbrellas, canManageGroups, visibleGroups } from "@/lib/groups";
import { requireUser, mySpelling } from "@/lib/session";
import { NewUmbrellaButton } from "@/components/umbrella-ui";
import { can } from "@/lib/permissions";

export default async function HomePage() {
  const user = await requireUser();
  const t = startTiming("Umbrellas page");
  const mine = user.isAdmin ? {} : { members: { some: { userId: user.id } } };
  // Everything the page needs before its cards, sent together (ver_100).
  const [
    projects,
    runTotals,
    spelling,
    manager,
    maker,
    umbrellaRows,
    myRuns,
    sortCookie,
  ] = await t.step(
    "page setup (sent together)",
    Promise.all([
      // Umbrella hubs show as their umbrella's card, never as projects of their own.
      db.project.findMany({
        where: { hubOf: null, ...mine },
        include: {
          members: { where: { userId: user.id } },
          pins: { where: { userId: user.id } },
          _count: {
            select: {
              cases: { where: { archived: false } },
              suites: { where: { archived: false } },
              members: true,
              runs: { where: { state: "ACTIVE" } },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
      db.testRun.groupBy({
        by: ["projectId"],
        where: { project: { hubOf: null, ...mine } },
        _count: true,
      }),
      mySpelling(),
      canManageGroups(user),
      canMakeUmbrellas(user),
      db.projectGroup.findMany({
        where: {
          hubProjectId: { not: null },
          ...(user.isAdmin ? {} : { hub: mine }),
        },
        orderBy: { name: "asc" },
        select: { id: true, pins: { where: { userId: user.id } } },
      }),
      // Runs with cases waiting for this person, so a tester can start from the first page.
      db.testRun.findMany({
        where: {
          state: "ACTIVE",
          project: {
            archivedAt: null,
            ...mine,
          },
          entries: {
            some: {
              assigneeId: user.id,
              status: { in: ["UNTESTED", "RETEST", "IN_PROGRESS"] },
            },
          },
        },
        include: {
          project: { select: { key: true, name: true } },
          entries: { where: { assigneeId: user.id }, select: { status: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      cookies(),
    ]),
  );
  const now = new Date();
  const [groups, { cards: umbrellas, activity }] = await Promise.all([
    t.step("groups", visibleGroups(user, manager)),
    umbrellaCards(
      user,
      umbrellaRows,
      projects.map((p) => p.id),
      spelling,
      now,
      t,
    ),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const liveUmbrellas = umbrellas.filter((u) => !u.archived);
  const umbrellaIds = new Set(umbrellas.map((u) => u.id));
  const empty =
    projects.length === 0 && groups.length === 0 && umbrellas.length === 0;
  const choices: GroupChoice[] = projects.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    archived: p.archivedAt !== null,
    groupId: p.groupId,
    groupName: p.groupId ? (groupName.get(p.groupId) ?? null) : null,
    canMove: user.isAdmin || can(p.members[0]?.role ?? null, "project:group"),
    cases: p._count.cases,
    suites: p._count.suites,
    inUmbrella: !!p.groupId && umbrellaIds.has(p.groupId),
  }));
  // Projects made before umbrellas (or moved out of one) sit under their own heading.
  const loose = projects.some((p) => !p.groupId || !umbrellaIds.has(p.groupId));

  const yourWork = myRuns.map((r) => ({
    href: `/p/${r.project.key}/runs/${r.number}/execute?mine=1`,
    run: `R${r.number} ${r.name}`,
    cycle: r.project.name,
    left: r.entries.filter(
      (e) =>
        e.status === "UNTESTED" ||
        e.status === "RETEST" ||
        e.status === "IN_PROGRESS",
    ).length,
  }));

  t.done();
  const subtitle =
    "Each umbrella is one product, with its test cases, Jira and team. Its test cycles are where you run tests, one for each round of testing.";

  return (
    <>
      <TopBar user={user} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        {empty ? (
          <>
            <PageHeader title="Umbrellas" />
            <EmptyState
              title="Start with an umbrella"
              action={
                maker ? (
                  <NewUmbrellaButton
                    choices={choices}
                    label="Make your first umbrella"
                  />
                ) : undefined
              }
            >
              An umbrella holds one product&apos;s test cases, Jira settings and
              team. Then you add a test cycle for each round of testing, such as
              one release on one platform.
              {maker ? "" : " Ask an admin to add you to one."}
            </EmptyState>
          </>
        ) : (
          <ProjectsBrowser
            subtitle={subtitle}
            yourWork={yourWork}
            newButton={maker ? <NewUmbrellaButton choices={choices} /> : null}
            sort={parseUmbrellaSort(
              sortCookie.get(UMBRELLA_SORT_COOKIE)?.value,
            )}
            umbrellaCards={umbrellas}
            canManageGroups={manager}
            looseHeading={umbrellas.length > 0 && loose}
            umbrellas={
              user.isAdmin
                ? liveUmbrellas.map((u) => ({ id: u.id, name: u.name }))
                : []
            }
            groups={groups
              .filter((g) => !umbrellaIds.has(g.id))
              .map((g) => ({
                id: `g:${g.id}`,
                groupId: null,
                group: g.id,
                kind: "group" as const,
                key: "",
                name: g.name,
                description: g.description,
                starred: g.pins[0]?.starred ?? false,
                visitedAt: null,
                position: g.pins[0]?.position ?? null,
                hidden: false,
                archivedAt: null,
                projectIds: projects
                  .filter((p) => p.groupId === g.id)
                  .map((p) => p.id),
              }))}
            projects={projects
              .filter((p) => !(p.groupId && umbrellaIds.has(p.groupId)))
              .map((p) => {
                const at = activity.get(p.id);
                return {
                  id: p.id,
                  key: p.key,
                  name: p.name,
                  description: p.description,
                  starred: p.pins[0]?.starred ?? false,
                  visitedAt: p.pins[0]?.visitedAt?.getTime() ?? null,
                  position: p.pins[0]?.position ?? null,
                  hidden: p.pins[0]?.hidden ?? false,
                  archivedAt: p.archivedAt?.getTime() ?? null,
                  groupId: p.groupId,
                  role: user.isAdmin ? "ADMIN" : p.members[0].role,
                  cases: p._count.cases,
                  members: p._count.members,
                  activeRuns: p._count.runs,
                  runs:
                    runTotals.find((t) => t.projectId === p.id)?._count ?? 0,
                  activity: at
                    ? `Active ${relativeTime(at, spelling, now)}`
                    : "No activity yet",
                };
              })}
          />
        )}
      </main>
    </>
  );
}
