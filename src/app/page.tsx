import { HowToLink } from "@/components/how-to-link";
import { runTag } from "@/lib/run-label";
import { type GroupChoice } from "@/components/group-dialogs";
import { ProjectsBrowser } from "@/components/projects-browser";
import { LIVE_BASH, NOT_BASH_CASE, NOT_BASH_RUN } from "@/lib/bash-cases";
import { cookies } from "next/headers";
import { parseUmbrellaSort, UMBRELLA_SORT_COOKIE, YOUR_WORK_COOKIE } from "@/lib/project-list";
import { TopBar } from "@/components/top-bar";
import { EmptyState, PageHeader } from "@/components/ui";
import { myRecentBashes } from "@/lib/bash-data";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { startTiming } from "@/lib/timing";
import { umbrellaCards } from "@/lib/umbrella-cards";
import { canMakeUmbrellas, canManageGroups, visibleGroups } from "@/lib/groups";
import { requireUser, mySpelling } from "@/lib/session";
import { readingBannerDue } from "@/lib/easier-reading";
import { ReadingBanner } from "@/components/reading-banner";
import { NewUmbrellaButton } from "@/components/umbrella-ui";
import { can } from "@/lib/permissions";
import { WaitingToJoin } from "@/components/join-request";
import { Avatar } from "@/components/avatar";
import { AskToBeAdded, WelcomePractice } from "@/components/welcome";
import { myPractice } from "@/lib/practice-data";
import { LiveRefresh } from "@/components/live-refresh";
import { adminsOf } from "@/lib/link-access-server";
import { NOT_PRACTICE } from "@/lib/practice";

export default async function HomePage() {
  const user = await requireUser();
  const t = startTiming("Umbrellas page");
  const mine = user.isAdmin ? NOT_PRACTICE : { ...NOT_PRACTICE, members: { some: { userId: user.id } } };
  // Everything the page needs before its cards, sent together.
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
              cases: { where: { archived: false, ...NOT_BASH_CASE } },
              suites: { where: { archived: false } },
              members: true,
              runs: { where: { state: "ACTIVE", ...NOT_BASH_RUN } },
              bugBashes: { where: LIVE_BASH(new Date()) },
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
        // Show all lists every run; this only guards against a runaway list.
        take: 100,
      }),
      cookies(),
    ]),
  );
  const now = new Date();
  const [groups, { cards: umbrellas, activity }, yourBashes] = await Promise.all([
    t.step("groups", visibleGroups(user, manager)),
    umbrellaCards(
      user,
      umbrellaRows,
      projects.map((p) => p.id),
      spelling,
      now,
      t,
    ),
    // Bug bashes you were in this week: your own finds, one click away.
    t.step("bashes", myRecentBashes(user.id, now)),
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

  const waiting = (st: string) =>
    st === "UNTESTED" || st === "RETEST" || st === "IN_PROGRESS";
  // Runs you already started come first, then the newest.
  const yourWork = myRuns
    .map((r) => ({
      href: `/p/${r.project.key}/runs/${r.number}/execute?mine=1`,
      run: r.name,
      number: r.number,
      tag: runTag(r),
      cycle: r.project.name,
      left: r.entries.filter((e) => waiting(e.status)).length,
      started: r.entries.some((e) => e.status !== "UNTESTED"),
    }))
    .sort((a, b) => Number(b.started) - Number(a.started));

  t.done();
  const subtitle =
    "Each umbrella is one product, with its test cases, Jira and team. Its test cycles are where you run tests, one for each round of testing.";

  return (
    <>
      <TopBar user={user} />
      <main id="main" tabIndex={-1} className="page page-list px-4 py-8">
        {/* ver_265: offered once (and once more after Not now). */}
        {readingBannerDue(user, new Date()) && <ReadingBanner />}
        {empty && !user.isAdmin ? (
          <WelcomeHome
            user={user}
            make={maker ? <NewUmbrellaButton choices={choices} label="Make your first umbrella" guided /> : null}
          />
        ) : empty ? (
          <>
            <PageHeader title="Umbrellas" />
            <EmptyState
              title="Start with an umbrella"
              action={
                <span className="inline-flex flex-wrap items-center justify-center gap-2">
                  {maker && <NewUmbrellaButton choices={choices} label="Make your first umbrella" guided />}
                  {/* ver_178: there's no left menu here yet, so the How-to guide gets its own button. */}
                  <HowToLink
                    task="first-ten-minutes"
                    testId="home-how-to"
                    className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-surface px-3.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                  >
                    Show me how it works
                  </HowToLink>
                </span>
              }
            >
              An umbrella is one product. It holds your test cases, your team
              and its test cycles, where you run tests.
              {maker ? "" : " Ask an admin to add you to one."}
            </EmptyState>
          </>
        ) : (
          <ProjectsBrowser
            subtitle={subtitle}
            yourWork={yourWork}
            yourBashes={yourBashes}
            yourWorkOpen={sortCookie.get(YOUR_WORK_COOKIE)?.value === "all"}
            newButton={maker ? <NewUmbrellaButton choices={choices} /> : null}
            sort={parseUmbrellaSort(
              sortCookie.get(UMBRELLA_SORT_COOKIE)?.value,
            )}
            umbrellaCards={umbrellas}
            canManageGroups={manager}
            looseHeading={umbrellas.length > 0 && loose}
            umbrellas={
              user.isAdmin
                ? liveUmbrellas
                    .filter((u) => u.canAddCycle)
                    .map((u) => ({ id: u.id, name: u.name }))
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
                  liveBashes: p._count.bugBashes,
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

/**
 * Welcome (ver_259): someone signed in who isn't on any umbrella yet. Two plain choices, never a
 * dead end: Join your team (names the workspace admins, one-tap Ask to be added) or Start a new
 * product (Make your first umbrella, with the How-to guide walking them through it). Join comes
 * first, since most new people belong to a team that's already here (persona audit, ver_113 #3).
 * Requests to join a team from a shared link show in Join's place.
 */
async function WelcomeHome({ user, make }: { user: { id: string; name: string | null; email: string }; make: React.ReactNode }) {
  const [rows, asked, adminRows, practice] = await Promise.all([
    db.joinRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, projectId: true, project: { select: { name: true, hubOf: { select: { name: true } } } } },
    }),
    db.workspaceJoinRequest.findUnique({ where: { userId: user.id }, select: { createdAt: true } }),
    db.user.findMany({ where: { isAdmin: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, avatarAt: true } }),
    myPractice(user.id),
  ]);
  const requests = await Promise.all(
    rows.map(async (r) => ({ id: r.id, team: r.project.hubOf?.name ?? r.project.name, at: r.createdAt.toISOString(), admins: await adminsOf(r.projectId) })),
  );
  const first = (user.name ?? "").trim().split(/\s+/)[0];
  const shown = adminRows.slice(0, 4);
  const card = "flex min-w-0 flex-col gap-2.5 rounded-lg border border-slate-200 bg-surface p-5 text-left shadow-sm";
  return (
    <div className="mx-auto max-w-3xl space-y-5 py-6" data-testid="welcome-home">
      <LiveRefresh url="/api/live/me" />
      <div className="text-center">
        <h1 className="font-heading text-2xl font-semibold text-slate-900">{first ? `Welcome, ${first}` : "Welcome to Flaw Patrol"}</h1>
        <p className="mt-1 text-slate-600">You&apos;re not on an umbrella yet. An umbrella is one product you test. Pick one:</p>
      </div>
      <div className={make ? "grid gap-4 sm:grid-cols-2" : "mx-auto max-w-md"}>
        {requests.length ? (
          <div className="min-w-0 space-y-3">
            {requests.map((r) => (
              <WaitingToJoin key={r.id} request={r} />
            ))}
          </div>
        ) : (
          <section className={card} aria-labelledby="welcome-join">
            <h2 id="welcome-join" className="font-heading text-lg font-semibold text-slate-900">
              Join your team
            </h2>
            <p className="text-sm text-slate-600">Your product is probably here already. {adminRows.length === 1 ? "This admin" : "These admins"} can add you:</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-800" aria-label="Admins">
              {shown.map((a) => (
                <li key={a.id} className="flex items-center gap-1.5">
                  <Avatar person={a} size={24} />
                  {a.name || a.email}
                </li>
              ))}
              {adminRows.length > shown.length && <li className="text-slate-500">and {adminRows.length - shown.length} more</li>}
            </ul>
            <AskToBeAdded admins={adminRows.map((a) => a.name || a.email)} askedAt={asked?.createdAt.toISOString() ?? null} />
          </section>
        )}
        {make && (
          <section className={card} aria-labelledby="welcome-make">
            <h2 id="welcome-make" className="font-heading text-lg font-semibold text-slate-900">
              Start a new product
            </h2>
            <p className="text-sm text-slate-600">Testing something that isn&apos;t here yet? We&apos;ll walk you through it, one step at a time.</p>
            <div className="mt-auto pt-1">{make}</div>
          </section>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <WelcomePractice resume={practice?.href ?? null} />
          <span className="text-slate-500">Only you see it.</span>
        </span>
        <HowToLink task="no-umbrella" testId="welcome-how-to" className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-600">
          Show me how it works
        </HowToLink>
      </div>
    </div>
  );
}
