import { type GroupChoice } from "@/components/group-dialogs";
import {
  ProjectsBrowser,
  type UmbrellaEntry,
} from "@/components/projects-browser";
import { cookies } from "next/headers";
import { parseUmbrellaSort, UMBRELLA_SORT_COOKIE } from "@/lib/project-list";
import { TopBar } from "@/components/top-bar";
import { EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { canManageGroups, visibleGroups } from "@/lib/groups";
import { lastActivity } from "@/lib/project-visits";
import { requireUser, mySpelling } from "@/lib/session";
import { NewUmbrellaButton } from "@/components/umbrella-ui";
import { can } from "@/lib/permissions";
import { loadUmbrella, parseShortcuts } from "@/lib/umbrella";
import {
  defaultShortcuts,
  freshShortcut,
  rcGlance,
  shortcutChoices,
} from "@/lib/umbrella-pages";

export default async function HomePage() {
  const user = await requireUser();
  // Umbrella hubs show as their umbrella's card, never as projects of their own.
  const projects = await db.project.findMany({
    where: {
      hubOf: null,
      ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }),
    },
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
  });
  const runTotals = await db.testRun.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _count: true,
  });
  const activity = await lastActivity(projects.map((p) => p.id));
  const now = new Date();
  const spelling = await mySpelling();
  const manager = await canManageGroups(user);
  const groups = await visibleGroups(user, manager);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const umbrellaRows = await db.projectGroup.findMany({
    where: {
      hubProjectId: { not: null },
      ...(user.isAdmin
        ? {}
        : { hub: { members: { some: { userId: user.id } } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, pins: { where: { userId: user.id } } },
  });
  const umbrellas: UmbrellaEntry[] = [];
  for (const row of umbrellaRows) {
    const u = await loadUmbrella(row.id, user);
    if (!u) continue;
    const at = [
      ...(
        await lastActivity([u.hub.id, ...u.projects.map((p) => p.id)])
      ).values(),
    ].reduce<number | null>((m, d) => Math.max(m ?? 0, d.getTime()), null);
    const choices = await shortcutChoices(u, await rcGlance(u));
    const fresh = new Map(
      choices.flatMap((c) => c.items).map((i) => [i.href, i]),
    );
    const picked = parseShortcuts(u.group.shortcuts).map((s) =>
      freshShortcut(u, s),
    );
    umbrellas.push({
      id: u.group.id,
      name: u.group.name,
      tagline: `Umbrella · ${at ? `Last activity ${relativeTime(new Date(at), spelling, now)}` : "No activity yet"}`,
      // Counts in a shortcut's subtitle are refreshed from the page it points at.
      shortcuts: (picked.length ? picked : defaultShortcuts(u)).map((s) => ({
        ...s,
        sub: fresh.get(s.href)?.sub ?? s.sub,
      })),
      choices: can(u.who, "umbrella:shortcuts") ? choices : null,
      archived: !!u.group.archivedAt,
      // A bug bash on now (ver_93): the card says so, with Join.
      live: u.live ? { href: `/p/${u.hub.key}/bashes/${u.live.id}/join`, endsAt: u.live.endsAt } : null,
      restore:
        u.group.archivedAt && can(u.who, "umbrella:archive")
          ? u.current.filter((p) => p.archivedWithUmbrella).map((p) => p.name)
          : null,
      starred: row.pins[0]?.starred ?? false,
      position: row.pins[0]?.position ?? null,
      hidden: row.pins[0]?.hidden ?? false,
      canArchive: can(u.who, "umbrella:archive"),
      activity: at,
      cycles: u.projects.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        archived: !!p.archivedAt,
      })),
    });
  }
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

  // Runs with cases waiting for this person, so a tester can start from the first page.
  const myRuns = await db.testRun.findMany({
    where: {
      state: "ACTIVE",
      project: {
        archivedAt: null,
        ...(user.isAdmin ? {} : { members: { some: { userId: user.id } } }),
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
  });
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
                user.isAdmin ? (
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
              {user.isAdmin ? "" : " Ask an admin to add you to one."}
            </EmptyState>
          </>
        ) : (
          <ProjectsBrowser
            subtitle={subtitle}
            yourWork={yourWork}
            newButton={
              user.isAdmin ? <NewUmbrellaButton choices={choices} /> : null
            }
            sort={parseUmbrellaSort(
              (await cookies()).get(UMBRELLA_SORT_COOKIE)?.value,
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
