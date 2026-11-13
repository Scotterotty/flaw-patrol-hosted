import Link from "next/link";
import { StatusLine } from "@/components/status-board";
import { Suspense, type ReactNode } from "react";
import { CrumbName } from "@/components/crumb-name";
import { HomeTrends, HomeTrendsLoading } from "@/components/home-trends";
import { Card, cx, EmptyState, InfoTip, LinkButton } from "@/components/ui";
import { StartBashButton } from "@/components/bash-start";
import { StartRunBox } from "@/components/start-run-box";
import { HowToLink } from "@/components/how-to-link";
import { AllSetCard, StartHereCard } from "@/components/first-day";
import { firstDay } from "@/lib/first-day";
import { myPractice } from "@/lib/practice-data";
import { PracticeOffer } from "@/components/practice";
import { anyGo, RunsInProgressList, type ProgressRun } from "@/components/runs-in-progress";
import { NOT_BASH_RUN } from "@/lib/bash-cases";
import { parseRunKinds, shownKind } from "@/lib/run-kinds";
import { runLive } from "@/lib/run-live";
import { mySpelling } from "@/lib/session";
import { countStatuses, isOpen, totals } from "@/lib/status";
import { AddUmbrellaProject } from "@/components/umbrella-add-project";
import { StartRcButton } from "@/components/umbrella-rc";
import { MoveCasesButton, ShortcutIcon } from "@/components/umbrella-ui";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { jiraConfigFor, looseProjects, platformColor, type Umbrella } from "@/lib/umbrella";
import { hubCounts } from "@/lib/umbrella-pages";
import type { ShortcutIcon as IconName } from "@/lib/umbrella";
import type { ToolId } from "@/lib/tools";

/** An umbrella's home: shortcuts to the pages used most, the Case library, runs, bugs and settings, and its test cycles. */
export async function UmbrellaHome({ u, user, welcome = false }: { u: Umbrella; user: { id: string; isAdmin: boolean }; welcome?: boolean }) {
  const g = `/g/${u.group.id}`;
  const hub = `/p/${u.hub.key}`;
  // An archived umbrella takes no new projects or RCs until it's restored.
  const archived = !!u.group.archivedAt;
  // The Start next release and Start a bug bash boxes get their own data when they open.
  // Tools: what the umbrella doesn't use leaves its Overview.
  const on = (t: ToolId) => u.tools.includes(t);
  const runsOn = on("runs");
  const canBash = !archived && can(u.who, "run:create") && on("bashes");
  const canRc = can(u.who, "umbrella:rc") && !archived && runsOn;
  const [counts, jira] = await Promise.all([hubCounts(u, user.id), jiraConfigFor(u.hub.id)]);
  const platformNames = u.platforms.map((p) => p.name);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  // Test cycles that still keep their own cases, outside the Case library.
  const own = await db.testCase.groupBy({ by: ["projectId"], where: { projectId: { in: u.projects.map((p) => p.id) }, archived: false }, _count: true });
  const left = u.projects.flatMap((p) => {
    const n = own.find((o) => o.projectId === p.id)?._count ?? 0;
    return n ? [{ id: p.id, name: p.name, cases: n }] : [];
  });
  const canManage = can(u.who, "umbrella:manage") && !archived;
  // Testers can make test cycles too; moving one in still needs a lead on that test cycle.
  const canAddCycle = can(u.who, "cycle:create") && !archived;
  // Projects outside any umbrella that could move in here.
  const loose = canAddCycle ? await looseProjects(user) : [];
  const addProject = (as: "menu" | "buttons", label?: string) => (
    <AddUmbrellaProject groupId={u.group.id} umbrella={u.group.name} platforms={platformNames} colors={u.platforms.map((p) => platformColor(u.platforms, p.name))} loose={loose} as={as} label={label} />
  );
  const [slackCount, memberCount, firstRun, bashCount, ratings] = await Promise.all([
    db.slackChannel.count({ where: { groupId: u.group.id } }),
    db.projectMember.count({ where: { projectId: u.hub.id } }),
    // Any run that isn't a bug bash, in any test cycle: the newest one names the setup step.
    db.testRun.findFirst({ where: { projectId: { in: u.projects.map((p) => p.id) }, bugBash: { is: null } }, orderBy: { createdAt: "desc" }, select: { project: { select: { id: true, name: true } } } }),
    // Without Test runs the list asks for a bug bash and a look at the risk board instead.
    runsOn ? 0 : db.bugBash.count({ where: { projectId: u.hub.id } }),
    runsOn ? 0 : db.riskRating.count({ where: { projectId: u.hub.id } }),
  ]);
  // Members' own "Start here" (ver_187): hides once they've saved a result anywhere in this umbrella.
  const isAdminHere = can(u.who, "members:manage");
  const [myFirstResult, meRow, myEarliest] = await Promise.all([
    db.testResult.findFirst({ where: { testerId: user.id, run: { projectId: { in: [u.hub.id, ...u.projects.map((p) => p.id)] } } }, select: { id: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { openCards: true, name: true, email: true } }),
    // Your very first saved result anywhere: the "You're set" card is for new people, not everyone after an update.
    db.testResult.findFirst({ where: { testerId: user.id, imported: false }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  // ver_216: Start here can be hidden for now (Getting started in the account menu brings it back).
  const prefs = firstDay(meRow?.openCards);
  const myFirst = (meRow?.name || meRow?.email || "").trim().split(/\s+/)[0];
  // Practice run (ver_217): offered at the top of Start here; Continue once you've started one.
  const practiceOn = runsOn && can(u.who, "run:execute") && !archived;
  const practice = practiceOn ? await myPractice(user.id) : null;
  const practiceOffer = practiceOn ? <PracticeOffer resume={practice} /> : null;
  const allSet = !!myFirstResult && !prefs.setSeen && !!myEarliest && Date.now() - myEarliest.createdAt.getTime() < 7 * 24 * 3600 * 1000;
  // Straight from an invite (ver_187): who added you, once, at the top.
  const hello = welcome
    ? await (async () => {
        const me = await db.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } });
        const link = await db.passwordLink.findFirst({ where: { userId: user.id, kind: "invite", usedAt: { not: null } }, orderBy: { usedAt: "desc" }, select: { createdById: true } });
        const by = link?.createdById ? await db.user.findUnique({ where: { id: link.createdById }, select: { name: true, email: true } }) : null;
        const first = (me?.name || me?.email || "").trim().split(/\s+/)[0];
        return { first, by: by ? by.name || by.email : null };
      })()
    : null;
  // Who starts runs, for a Member's Start here when there are none yet (ver_216): whoever invited them, or an Admin.
  const starter =
    !isAdminHere && runsOn && !firstRun
      ? (hello?.by ??
        (await db.projectMember
          .findFirst({ where: { projectId: u.hub.id, role: "ADMIN", userId: { not: user.id } }, orderBy: { createdAt: "asc" }, select: { user: { select: { name: true, email: true } } } })
          .then((m) => (m ? m.user.name || m.user.email : null))))
      : null;
  const firstOpen = firstRun ? await db.testRun.count({ where: { projectId: firstRun.project.id, state: "ACTIVE", bugBash: { is: null } } }) : 0;
  // One Create a run button: it asks the kind of run and can make the test cycle too.
  const canRun = can(u.who, "run:create") && !archived && runsOn && (u.current.length > 0 || canAddCycle);
  // Runs in progress (ver_163): the first thing on the Overview, so anyone new sees where to test.
  // Every test cycle that isn't archived, plus the hub; bug bashes have their own pages.
  const canExecute = can(u.who, "run:execute");
  const liveCycles = u.projects.filter((p) => !p.archivedAt || (archived && p.archivedWithUmbrella));
  const [progressRaw, spelling] = await Promise.all([
    runsOn
      ? db.testRun.findMany({
          where: { projectId: { in: [u.hub.id, ...liveCycles.map((p) => p.id)] }, state: "ACTIVE", ...NOT_BASH_RUN },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, number: true, name: true, kind: true, release: true, build: true, createdAt: true, project: { select: { key: true, name: true, platform: true } }, entries: { select: { status: true, assigneeId: true, kind: true } } },
        })
      : Promise.resolve([]),
    mySpelling(),
  ]);
  const progressLive = await runLive(progressRaw.map((r) => r.id));
  const waiting: ProgressRun[] = progressRaw
    .map((r) => {
      const counts = countStatuses(r.entries.map((e) => e.status));
      const mine = r.entries.filter((e) => e.assigneeId === user.id);
      const label = r.project.platform || r.project.name;
      return {
        id: r.id,
        number: r.number,
        name: r.name,
        build: r.build,
        release: r.release,
        createdAt: r.createdAt,
        counts,
        t: totals(counts),
        mine: mine.length,
        mineLeft: mine.filter((e) => isOpen(e.status)).length,
        shown: shownKind(r),
        live: progressLive.get(r.id),
        projectKey: r.project.key,
        cycle: { name: r.project.name, badge: initials(label), color: platformColor(u.platforms, r.project.platform) },
      };
    })
    // Every case has a result: it only waits for someone to close it, on its test cycle's page.
    .filter((r) => !(r.t.total > 0 && r.t.tested === r.t.total));
  const kinds = parseRunKinds(u.group.runKinds);
  const goWaiting = anyGo(waiting, canExecute);
  // What a new umbrella still needs. Jira is optional, so it never holds the list open on its own.
  // "Start here" (ver_178): the core loop first, the optional extras last.
  const isAdmin = can(u.who, "members:manage");
  const allSetup = [
    { done: u.counts.cases > 0, tool: "cases" as ToolId, label: "Add your test cases (import a file or write them)", note: plural(u.counts.cases, "case"), href: `${hub}/import`, action: "Import cases", task: "import-cases" },
    {
      done: !!firstRun,
      tool: "runs" as ToolId,
      label: "Run your first tests",
      note: firstRun ? `${firstRun.project.name} is ${firstOpen ? "in progress" : "done"}` : "",
      href: `${g}?start=run`,
      action: "Create a run",
      task: "create-run",
    },
    ...(runsOn
      ? []
      : [
          { done: bashCount > 0, tool: "bashes" as ToolId, label: "Start your first bug bash", note: plural(bashCount, "bug bash").replace("bashs", "bashes"), href: `${hub}/bashes?bash=start`, action: "Start a bug bash", task: "start-bash" },
          { done: ratings > 0, tool: "risk" as ToolId, label: "Look over the risk board", note: "", href: `${hub}/risk`, action: "Open it", task: "risk-board", tip: "Rate which requirements in a release are most likely to break, and how much it would hurt." },
        ]),
    // Who's on the team is for Admins only (ver_168), so only they get the Invite step. Choosing what
    // roles can do comes first, as a link on the same step (Members also asks before the first invite).
    ...(isAdmin
      ? [
          {
            done: memberCount > 1,
            label: "Invite your team",
            note: plural(memberCount, "person").replace("persons", "people"),
            href: `${g}/settings#members`,
            action: "Invite",
            task: "invite",
            first: u.group.rolesChosenAt ? undefined : { label: "Choose what roles can do first", href: `${g}/settings#roles` },
          },
        ]
      : []),
    { done: !!jira, label: on("stories") ? "Connect Jira" : "Connect Jira (optional)", note: "", href: `${g}/settings#jira`, action: "Connect", task: "connect-jira" },
    // Optional: runs work without a suite, so it never keeps the list open. A team that already ran tests has it ticked.
    { done: u.counts.suites > 0 || !!firstRun, tool: "cases" as ToolId, label: "Make a suite (optional)", note: u.counts.suites ? plural(u.counts.suites, "suite") : "", href: `${hub}/suites/new`, action: "Make a suite", task: "make-suite", tip: "A saved list of cases you run together, like Smoke or Full regression. You can also run the whole Case library or pick cases." },
    { done: slackCount > 0, label: "Send alerts to Slack (optional)", note: plural(slackCount, "channel"), href: `${g}/settings#slack`, action: "Add channels", task: "alerts", tip: "Post regressions, serious bugs and finished runs to Slack channels. Every test cycle follows them." },
  ];
  const setup = allSetup.filter((s) => !("tool" in s) || !s.tool || on(s.tool));
  // A second release means the first one happened, so the list hides then too.
  const rcs = new Set(u.projects.map((p) => p.rcName.trim().toLowerCase()).filter(Boolean));
  const ready = runsOn ? rcs.size > 1 || (u.counts.cases > 0 && !!firstRun && (!!jira || u.older.length > 0)) : setup.every((s) => s.done || s.label.includes("optional"));

  const allShortcuts: { label: string; href: string; icon: IconName; count?: number; external?: boolean; tool?: ToolId }[] = [
    { label: "Release status", href: `${g}/rc`, icon: "chart", tool: "runs" },
    { label: "My assigned cases", href: `${g}/runs?mine=1`, icon: "play", count: counts.mine, tool: "runs" },
    // Bugs are filed from the runner, with the template and case link; this only opens Jira.
    ...(jira ? [{ label: "Open Jira", href: `${jira.siteUrl}/browse/${jira.jiraProjectKey}`, icon: "link" as const, external: true }] : []),
    { label: "Critical bugs", href: `${g}/bugs?sev=critical`, icon: "bug", count: counts.critical },
    { label: "Flagged cases", href: `${hub}/cases?flagged=1`, icon: "folder", count: counts.flagged, tool: "cases" },
    // Viewers can't import: the shortcut opened "Not found".
    ...(can(u.who, "import") ? [{ label: "Import cases", href: `${hub}/import`, icon: "down" as const, tool: "cases" as ToolId }] : []),
    { label: "Reports", href: `${g}/reports`, icon: "chart" },
  ];
  const shortcuts = allShortcuts.filter((s) => !s.tool || on(s.tool));
  // Shortcuts and How testing is going wait for the first results (ver_178): on day one they were empty.
  // An umbrella without Test runs keeps its shortcuts from the start.
  const started = !!firstRun || !runsOn;

  return (
    <div className="page page-list">
      <CrumbName href={g} label={u.group.name} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-900">
            {u.group.name}
            <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-accent-700 uppercase">Umbrella</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">{u.group.description || (runsOn ? `Every ${u.group.name} test case, run, bug and setting, in one place` : `Everything ${u.group.name} finds, in one place`)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* One button: Create a run asks the kind first. Release candidate and Bug bash open these boxes. */}
          {canRun && <StartRunBox scope={{ groupId: u.group.id }} label="▶ Create a run" openParam="run" variant={goWaiting ? "secondary" : "primary"} />}
          {/* Write a bug: for a bug found outside a test, next to Create a run so it's seen on arrival. */}
          {canExecute && !archived && (
            <LinkButton href={`${g}/bugs?write=1`} data-testid="overview-write-bug">
              + Write a bug
            </LinkButton>
          )}
          {/* Without Test runs, Start a bug bash is the button. */}
          {canBash && <StartBashButton projectId={u.hub.id} hideButton={runsOn} />}
          {canRc && <StartRcButton groupId={u.group.id} umbrella={u.group.name} hasRelease={u.projects.length > 0} canManage={canManage} canSuites={can(u.who, "suite:manage")} canCases={can(u.who, "case:edit")} canImport={can(u.who, "import")} hideButton />}
        </div>
      </div>

      {/* Status (ver_228): one line when builds or tools are connected; nothing otherwise. */}
      <StatusLine groupId={u.group.id} />

      {/* A brand-new umbrella with nothing running yet has its setup list instead. */}
      {runsOn && (waiting.length > 0 || ready) && (
        <Card className="mb-6 overflow-hidden" data-testid="umbrella-runs-in-progress">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Runs in progress</h2>
            {waiting.length > 0 && (
              <Link href={`${g}/runs`} className="text-xs text-accent-700 hover:underline">
                {waiting.length > 5 ? `All ${waiting.length} runs` : "All runs"}
              </Link>
            )}
          </div>
          {waiting.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">{canRun ? "No runs in progress yet. Press Create a run to make one, and it shows here." : "No runs in progress. When someone creates a run, it shows here."}</p>
          ) : (
            <RunsInProgressList rows={waiting.slice(0, 5)} kinds={kinds} canExecute={canExecute} spelling={spelling} />
          )}
        </Card>
      )}

      {hello && (
        <p className="mb-4 rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-slate-800" data-testid="umbrella-hello">
          <span className="font-semibold">Welcome{hello.first ? `, ${hello.first}` : ""}.</span> {hello.by ? `${hello.by} added you to ${u.group.name}.` : `You're in ${u.group.name}.`} Your runs, cases and bugs are all in here.
        </p>
      )}

      {/* Members get three steps of their own (ver_187): the setup list is admin work. */}
      {allSet && <AllSetCard first={myFirst} />}

      {!isAdminHere && runsOn && canExecute && !archived && !myFirstResult && !prefs.startHidden && (
        <StartHereCard testId="member-start-here" progress="hides after your first saved result">
          {practiceOffer}
          <ol className="space-y-1.5">
            {[
              {
                label: "Open a run and test a case",
                task: "test-case",
                // ver_216: with no run yet, say who starts one instead of sending you to an empty page.
                go: waiting[0] ? { href: `/p/${waiting[0].projectKey}/runs/${waiting[0].number}/execute`, label: "Start testing" } : firstRun ? { href: `${g}/runs`, label: "Test runs" } : null,
                wait: waiting[0] || firstRun ? null : starter ? `No runs yet. ${starter} will start one.` : "No runs yet. An admin will start one.",
              },
              { label: "Report a bug from a failed step", task: "report-bug" },
              ...(can(u.who, "case:edit") && on("cases") ? [{ label: "Write a test case", task: "write-case" }] : []),
            ].map((s, i) => (
              <li key={s.task} className="flex items-center gap-2.5 text-sm">
                <span aria-hidden className="grid size-5 flex-none place-items-center rounded-full border border-slate-300 text-[11px] font-semibold text-slate-500">
                  {i + 1}
                </span>
                <span className="flex-1 text-slate-800">
                  {s.label}
                  {"wait" in s && s.wait && (
                    <span className="block text-xs text-slate-600" data-testid="member-no-runs">
                      {s.wait}
                    </span>
                  )}
                </span>
                {"go" in s && s.go && (
                  <LinkButton size="sm" href={s.go.href} data-testid="member-start-testing">
                    {s.go.label}
                  </LinkButton>
                )}
                <HowToLink task={s.task} testId={`member-show-${s.task}`} className="rounded-md border border-slate-200 bg-surface px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  Show me
                </HowToLink>
              </li>
            ))}
          </ol>
        </StartHereCard>
      )}

      {!ready && canManage && isAdminHere && !prefs.startHidden && (
        <StartHereCard testId="admin-start-here" progress={`${setup.filter((s) => s.done).length} of ${setup.length} done · hides when finished`}>
          {/* The first-time welcome on a new umbrella, for admins until roles are chosen. */}
          {can(u.who, "members:manage") && !u.group.rolesChosenAt && memberCount <= 1 && (
            <p className="mb-2 text-sm text-slate-600" data-testid="umbrella-welcome">
              Your umbrella is ready. Everyone you invite can use every feature, and only admins can archive, delete or change connections.{" "}
              <Link className="text-accent-700 hover:underline" href={`${g}/settings#roles`}>
                Change what roles can do
              </Link>
            </p>
          )}
          {(!myFirstResult || practice) && practiceOffer}
          <ol className="space-y-1.5">
            {setup.map((s, i) => (
              <li key={s.label} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={cx("grid size-5 flex-none place-items-center rounded-full text-[11px] font-semibold", s.done ? "bg-emerald-600 text-white" : "border border-slate-300 text-slate-500")}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span className={cx("flex-1", s.done ? "text-slate-500" : "text-slate-800")}>
                  {s.label}
                  {s.done && s.note && <span className="ml-1.5 text-xs">· {s.note}</span>}
                  {"tip" in s && s.tip && !s.done && <InfoTip text={s.tip} className="ml-1 align-middle" />}
                  {"first" in s && s.first && !s.done && (
                    <Link href={s.first.href} className="ml-2 text-xs text-accent-700 hover:underline" data-testid="setup-roles-first">
                      {s.first.label}
                    </Link>
                  )}
                </span>
                {!s.done && (
                  <LinkButton size="sm" href={s.href} data-howto={s.task === "invite" ? "start-invite" : undefined}>
                    {s.action}
                  </LinkButton>
                )}
                {/* ver_216: every step can show you how, like the Members' list. */}
                {!s.done && s.task && (
                  <HowToLink task={s.task} testId={`admin-show-${s.task}`} className="rounded-md border border-slate-200 bg-surface px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    Show me
                  </HowToLink>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-slate-600">
            New here? <HowToLink className="text-accent-700 hover:underline">Open the How-to guide</HowToLink> for step-by-step help with Show me.
          </p>
        </StartHereCard>
      )}

      {left.length > 0 && canManage && on("cases") && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex-1">
            {left.length === 1
              ? `${plural(left[0].cases, "case")} still in ${left[0].name}, outside the ${u.group.name} case library.`
              : `${plural(left.reduce((n, p) => n + p.cases, 0), "case")} are still in ${left.length} test cycles, outside the ${u.group.name} case library.`}
          </span>
          <MoveCasesButton groupId={u.group.id} umbrella={u.group.name} projects={left} label="Move them" />
        </div>
      )}

      {started && (
        <>
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Shortcuts</p>
      <ul className="mb-6 flex flex-wrap gap-2">
        {shortcuts.map((s) => (
          <li key={s.label}>
            <Pill href={s.href} external={s.external}>
              <ShortcutIcon icon={s.icon} className="size-4 text-accent-600" />
              {s.label}
              {!!s.count && <span className="rounded-full bg-accent-600 px-1.5 text-[11px] font-semibold text-white tabular-nums">{s.count}</span>}
            </Pill>
          </li>
        ))}
      </ul>

      {/* How testing is going: pass rates by release or week, Flaky and Keeps failing. Streams in last. */}
      {runsOn && (
        <Suspense fallback={<HomeTrendsLoading />}>
          <HomeTrends u={u} userId={user.id} startHref={canRun ? `${g}?start=run` : null} />
        </Suspense>
      )}
        </>
      )}

      {runsOn && (
      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">Test cycles in {u.group.name}</h2>
          {u.older.length > 0 && (
            <Link href={`${g}/projects`} className="text-sm text-accent-700 hover:underline">
              Show {u.older.length} older
            </Link>
          )}
        </div>
        {u.current.length === 0 ? (
          <div className="p-4">
            <EmptyState title={`No test cycles in ${u.group.name} yet`} action={canAddCycle ? addProject("buttons") : undefined}>
              Test cycles are where your team runs tests. Each one uses {u.group.name}&apos;s cases, Jira and team.
              {canRun ? " Create a run makes one for you, and its Release candidate kind makes one per platform in one go." : ""}
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {u.current.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <ProjectBadge name={p.platform || p.name} color={platformColor(u.platforms, p.platform)} />
                <span className="min-w-0 flex-1">
                  <Link href={`/p/${p.key}`} className="block truncate font-medium text-slate-900 hover:underline">
                    {p.name}
                  </Link>
                  <span className="block truncate text-xs text-slate-500">{p.description || (p.platform ? [p.platform, p.rcName].filter(Boolean).join(" · ") : p.key)}</span>
                </span>
                <span className="text-sm text-slate-500">{plural(p._count.runs, "active run")}</span>
                <LinkButton size="sm" href={`/p/${p.key}`}>
                  Open
                </LinkButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}
    </div>
  );
}

function Pill({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
  const cls = "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-surface px-3.5 py-1.5 text-sm text-slate-800 hover:border-accent-500 hover:text-accent-700";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** A platform's initials (U, UE, W) for its colored square. */
function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w[0]).join("") : name[0] ?? "").slice(0, 2).toUpperCase();
}

/** A colored square with a project's platform initials (U, UE, W). */
export function ProjectBadge({ name, color, small }: { name: string; color: string; small?: boolean }) {
  return (
    <span aria-hidden className={cx("grid flex-none place-items-center rounded-md font-semibold text-white", small ? "size-6 text-[11px]" : "size-8 text-xs")} style={{ background: color }}>
      {initials(name)}
    </span>
  );
}
