import Link from "next/link";
import type { ReactNode } from "react";
import { CrumbName } from "@/components/crumb-name";
import { Card, cx, EmptyState, InfoTip, LinkButton } from "@/components/ui";
import { StartBashButton } from "@/components/bash-start";
import { StartRunBox } from "@/components/start-run-box";
import { AddUmbrellaProject, MoveCasesButton, ShortcutIcon, StartRcButton } from "@/components/umbrella-ui";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { jiraConfigFor, looseProjects, platformColor, type Umbrella } from "@/lib/umbrella";
import { hubCounts } from "@/lib/umbrella-pages";
import type { ShortcutIcon as IconName } from "@/lib/umbrella";

/** An umbrella's home: shortcuts to the pages used most, the Case library, runs, bugs and settings, and its test cycles. */
export async function UmbrellaHome({ u, user }: { u: Umbrella; user: { id: string; isAdmin: boolean } }) {
  const g = `/g/${u.group.id}`;
  const hub = `/p/${u.hub.key}`;
  // An archived umbrella takes no new projects or RCs until it's restored.
  const archived = !!u.group.archivedAt;
  // The Start next release and Start a bug bash boxes get their own data when they open (ver_120).
  const canBash = !archived && can(u.who, "run:create");
  const canRc = can(u.who, "umbrella:rc") && !archived;
  const [counts, jira] = await Promise.all([hubCounts(u, user.id), jiraConfigFor(u.hub.id)]);
  const platformNames = u.platforms.map((p) => p.name);
  const across = platformNames.length ? `Across ${list(platformNames)}` : "Across every test cycle under it";
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
  const [slackCount, memberCount, firstRun] = await Promise.all([
    db.slackChannel.count({ where: { groupId: u.group.id } }),
    db.projectMember.count({ where: { projectId: u.hub.id } }),
    // Any run that isn't a bug bash, in any test cycle (ver_95): the newest one names the setup step.
    db.testRun.findFirst({ where: { projectId: { in: u.projects.map((p) => p.id) }, bugBash: { is: null } }, orderBy: { createdAt: "desc" }, select: { project: { select: { id: true, name: true } } } }),
  ]);
  const firstOpen = firstRun ? await db.testRun.count({ where: { projectId: firstRun.project.id, state: "ACTIVE", bugBash: { is: null } } }) : 0;
  // One Start a run button (ver_95): it asks the kind of run and can make the test cycle too.
  const canRun = can(u.who, "run:create") && !archived && (u.current.length > 0 || canAddCycle);
  // What a new umbrella still needs. Jira is optional, so it never holds the list open on its own.
  const setup = [
    { done: u.counts.cases > 0, label: "Add your test cases (import a file or write them)", note: plural(u.counts.cases, "case"), href: `${hub}/import`, action: "Import cases" },
    // Optional (ver_118): runs work without a suite, so it never keeps the list open. A team that already ran tests has it ticked.
    { done: u.counts.suites > 0 || !!firstRun, label: "Make a suite (optional)", note: u.counts.suites ? plural(u.counts.suites, "suite") : "", href: `${hub}/suites/new`, action: "Make a suite", tip: "A saved list of cases you run together, like Smoke or Full regression. You can also run the whole Case library or pick cases." },
    {
      done: !!firstRun,
      label: "Run your first tests",
      note: firstRun ? `${firstRun.project.name} is ${firstOpen ? "in progress" : "done"}` : "",
      href: `${g}?start=run`,
      action: "Start a run",
    },
    // Admins choose what roles can do before inviting (ver_96); saving it once, or Keep everyone open, ticks it.
    ...(can(u.who, "members:manage")
      ? [{ done: !!u.group.rolesChosenAt, label: "Choose what roles can do", note: "", href: `${g}/settings#roles`, action: "Review", tip: "Everyone can use everything except archive, delete and connections. Tighten it before you invite." }]
      : []),
    { done: memberCount > 1, label: "Invite your team", note: plural(memberCount, "person").replace("persons", "people"), href: `${g}/settings#members`, action: "Invite" },
    { done: !!jira, label: "Connect Jira (optional)", note: "", href: `${g}/settings#jira`, action: "Connect" },
    { done: slackCount > 0, label: "Send alerts to Slack (optional)", note: plural(slackCount, "channel"), href: `${g}/settings#slack`, action: "Add channels", tip: "Post regressions, serious bugs and finished runs to Slack channels. Every test cycle follows them." },
  ];
  // A second release means the first one happened, so the list hides then too (ver_91).
  const rcs = new Set(u.projects.map((p) => p.rcName.trim().toLowerCase()).filter(Boolean));
  const ready = rcs.size > 1 || (setup[0].done && !!firstRun && (!!jira || u.older.length > 0));

  const shortcuts: { label: string; href: string; icon: IconName; count?: number; external?: boolean }[] = [
    { label: "Release status", href: `${g}/rc`, icon: "chart" },
    { label: "My assigned cases", href: `${g}/runs?mine=1`, icon: "play", count: counts.mine },
    // Bugs are filed from the runner, with the template and case link; this only opens Jira (ver_85).
    ...(jira ? [{ label: "Open Jira", href: `${jira.siteUrl}/browse/${jira.jiraProjectKey}`, icon: "link" as const, external: true }] : []),
    { label: "Critical bugs", href: `${g}/bugs?sev=critical`, icon: "bug", count: counts.critical },
    { label: "Flagged cases", href: `${hub}/cases?flagged=1`, icon: "folder", count: counts.flagged },
    { label: "Import cases", href: `${hub}/import`, icon: "down" },
    { label: "Reports", href: `${g}/reports`, icon: "chart" },
  ];
  const cards: { label: string; href: string; icon: IconName; count: string; text: string }[] = [
    { label: "Case library", href: `${hub}/cases`, icon: "book", count: String(u.counts.cases), text: `Whole test cases every ${u.group.name} test cycle runs` },
    { label: "Suites", href: `${hub}/suites`, icon: "layers", count: String(u.counts.suites), text: "Groups of cases you run together" },
    { label: "Shared steps", href: `${hub}/shared-steps`, icon: "link", count: String(u.counts.shared), text: "Steps like \u201cSign in\u201d you add to new or existing cases" },
    { label: "Test runs", href: `${g}/runs`, icon: "play", count: `${u.counts.activeRuns} active`, text: across },
    { label: "Bugs", href: `${g}/bugs`, icon: "bug", count: `${u.counts.openBugs} open`, text: `Everything filed from ${u.group.name}${jira ? `, in Jira ${jira.jiraProjectKey}` : ""}` },
    { label: "Settings", href: `${g}/settings`, icon: "cog", count: "", text: "Jira, bug template and team, set once" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <CrumbName href={g} label={u.group.name} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-900">
            {u.group.name}
            <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-accent-700 uppercase">Umbrella</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">{u.group.description || `Every ${u.group.name} test case, run, bug and setting, in one place`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* One button (ver_95): Start a run asks the kind first. Release candidate and Bug bash open these boxes. */}
          {canRun && <StartRunBox scope={{ groupId: u.group.id }} label="▶ Start a run" openParam="run" />}
          {canBash && <StartBashButton projectId={u.hub.id} hideButton />}
          {canRc && <StartRcButton groupId={u.group.id} umbrella={u.group.name} hasRelease={u.projects.length > 0} canManage={canManage} canSuites={can(u.who, "suite:manage")} canCases={can(u.who, "case:edit")} canImport={can(u.who, "import")} hideButton />}
        </div>
      </div>

      {!ready && canManage && (
        <Card className="mb-6 p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-slate-900">Get {u.group.name} set up</h2>
            <span className="text-xs text-slate-500">{setup.filter((s) => s.done).length} of {setup.length} done · hides when finished</span>
          </div>
          {/* The first-time welcome on a new umbrella (ver_96), for admins until roles are chosen. */}
          {can(u.who, "members:manage") && !u.group.rolesChosenAt && memberCount <= 1 && (
            <p className="mb-2 text-sm text-slate-600" data-testid="umbrella-welcome">
              Your umbrella is ready. Everyone you invite can use every feature, and only admins can archive, delete or change connections.{" "}
              <Link className="text-accent-700 hover:underline" href={`${g}/settings#roles`}>
                Change what roles can do
              </Link>
            </p>
          )}
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
                </span>
                {!s.done && (
                  <LinkButton size="sm" href={s.href}>
                    {s.action}
                  </LinkButton>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {left.length > 0 && canManage && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex-1">
            {left.length === 1
              ? `${plural(left[0].cases, "case")} still in ${left[0].name}, outside the ${u.group.name} case library.`
              : `${plural(left.reduce((n, p) => n + p.cases, 0), "case")} are still in ${left.length} test cycles, outside the ${u.group.name} case library.`}
          </span>
          <MoveCasesButton groupId={u.group.id} umbrella={u.group.name} projects={left} label="Move them" />
        </div>
      )}

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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="group">
            <Card className="h-full p-5 transition group-hover:border-accent-500 group-hover:shadow">
              <span className="mb-3 grid size-9 place-items-center rounded-lg bg-accent-50 text-accent-600">
                <ShortcutIcon icon={c.icon} className="size-5" />
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold text-slate-900">{c.label}</span>
                <span className="text-sm font-medium text-slate-600 tabular-nums">{c.count}</span>
              </span>
              <span className="mt-1 block text-sm text-slate-500">{c.text}</span>
            </Card>
          </Link>
        ))}
      </div>

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
              {canRun ? " Start a run makes one for you, and its Release candidate kind makes one per platform in one go." : ""}
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

/** A colored square with a project's platform initials (U, UE, W). */
export function ProjectBadge({ name, color, small }: { name: string; color: string; small?: boolean }) {
  const words = name.split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words.map((w) => w[0]).join("") : name[0] ?? "").slice(0, 2).toUpperCase();
  return (
    <span aria-hidden className={cx("grid flex-none place-items-center rounded-md font-semibold text-white", small ? "size-5 text-[9px]" : "size-8 text-xs")} style={{ background: color }}>
      {initials}
    </span>
  );
}

function list(names: string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
