import { funOff } from "@/lib/fun";
import Link from "next/link";
import { RunName } from "@/components/run-name";
import { FlagIcon } from "@/components/case-flag";
import { LIVE_BASH, NOT_BASH_CASE, NOT_BASH_RUN } from "@/lib/bash-cases";
import { StartRunBox } from "@/components/start-run-box";
import { PassRateOverTime } from "@/components/trend-charts";
import { Badge, Card, cx, LinkButton, PageHeader } from "@/components/ui";
import { flagLabel } from "@/lib/case-flag";
import { db } from "@/lib/db";
import { mailOn } from "@/lib/mail";
import { capitalize, caseKey, count, minutesSpent, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { caseHealth, trends } from "@/lib/reports";
import { projectAccess, mySpelling } from "@/lib/session";
import { countStatuses, isOpen, pct, totals } from "@/lib/status";
import { redirect } from "next/navigation";
import { cycleSettingsHref, hubGroupId, umbrellaOf } from "@/lib/umbrella";
import { InviteTeam, QuestMapOnButton } from "@/components/overview-extras";
import { RolesNudge } from "@/components/roles-nudge";
import { MoveCasesButton } from "@/components/umbrella-ui";
import { CloseRunButton } from "@/components/run-actions";
import { anyGo, RunsInProgressList } from "@/components/runs-in-progress";
import { EXPLORE_KIND, parseRunKinds, shownKind } from "@/lib/run-kinds";
import { runLive } from "@/lib/run-live";
import { QaseBar } from "@/components/qase-bar";
import { qaseRunUrl } from "@/lib/qase";
import { queueQasePull } from "@/lib/qase-sync";
import { noteCounts, parseSessionLog } from "@/lib/charter";

export const metadata = { title: "Overview" };

const DAY = 86400_000;

/** The project at a glance: runs in progress, how testing is trending, open bugs, and what needs someone's attention. */
export default async function ProjectOverview({ params }: { params: Promise<{ key: string }> }) {
  const spelling = await mySpelling();
  const { key } = await params;
  const { project, user, who } = await projectAccess(key);
  // An umbrella's hub shows its runs and bugs on the umbrella's own pages.
  const umbrellaId = await hubGroupId(project.id);
  if (umbrellaId) redirect(`/g/${umbrellaId}`);
  const now = new Date();
  const month = { from: new Date(now.getTime() - 30 * DAY), to: now };

  const [umbrella, memberCount] = await Promise.all([umbrellaOf(project), db.projectMember.count({ where: { projectId: project.id } })]);
  const [runs, openBugs, openBugCount, flagged, flaggedCount, caseCount, trend, health] = await Promise.all([
    db.testRun.findMany({
      where: { projectId: project.id, state: "ACTIVE", ...NOT_BASH_RUN },
      orderBy: { number: "desc" },
      take: 50,
      select: { id: true, number: true, name: true, kind: true, release: true, build: true, createdAt: true, entries: { select: { status: true, assigneeId: true, kind: true } } },
    }),
    db.defect.findMany({
      where: { projectId: project.id, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, number: true, title: true, severity: true, externalKey: true, externalUrl: true, externalStatus: true, createdAt: true },
    }),
    db.defect.count({ where: { projectId: project.id, status: "OPEN" } }),
    db.testCase.findMany({
      where: { projectId: project.id, archived: false, flag: { not: null } },
      orderBy: { flaggedAt: "desc" },
      take: 6,
      select: { number: true, title: true, flag: true, flagNote: true, flaggedBy: true, flaggedAt: true },
    }),
    db.testCase.count({ where: { projectId: project.id, archived: false, flag: { not: null } } }),
    db.testCase.count({ where: { projectId: project.id, archived: false, ...NOT_BASH_CASE } }),
    trends(project.id, month),
    caseHealth(project.id, { from: new Date(now.getTime() - 90 * DAY), to: now }),
  ]);
  const kinds = parseRunKinds(umbrella?.group.runKinds);
  const live = await runLive(runs.map((r) => r.id), now);
  // 🧭 Explored, last 30 days: exploring isn't in the pass rate, so it gets its own tile.
  const explored = await db.testResult.findMany({
    where: { run: { projectId: project.id }, entry: { kind: "EXPLORATORY" }, createdAt: { gte: month.from } },
    select: { elapsedSec: true, sessionLog: true },
  });
  const exploredFinds = explored.reduce((acc, r) => {
    const c = noteCounts(parseSessionLog(r.sessionLog));
    return { bugs: acc.bugs + c.bug, questions: acc.questions + c.question };
  }, { bugs: 0, questions: 0 });
  const exploredSec = explored.reduce((n, r) => n + (r.elapsedSec ?? 0), 0);
  const libraryCount = umbrella && !umbrella.isHub ? await db.testCase.count({ where: { projectId: umbrella.hub.id, archived: false, ...NOT_BASH_CASE } }) : 0;
  // A live bug bash gets its own tile instead of counting as a run. Only while one is live.
  // Qase: this cycle's run and how the last sync went; opening the page brings Qase results in.
  const qase = umbrella && !umbrella.isHub && !project.archivedAt ? await db.qaseConfig.findUnique({ where: { groupId: umbrella.group.id }, select: { projectCode: true } }) : null;
  if (qase) queueQasePull(project.id);
  const liveBash = await db.bugBash.findFirst({ where: { projectId: project.id, ...LIVE_BASH(now) }, orderBy: { startsAt: "desc" }, select: { id: true, name: true, endsAt: true } });

  const open = runs.map((r) => {
    const counts = countStatuses(r.entries.map((e) => e.status));
    const mine = r.entries.filter((e) => e.assigneeId === user.id);
    return { ...r, projectKey: project.key, counts, t: totals(counts), mineLeft: mine.filter((e) => isOpen(e.status)).length, mine: mine.length, shown: shownKind(r), live: live.get(r.id) };
  });
  // A run where every case has a result is finished; it only waits for someone to close it.
  const finished = open.filter((r) => r.t.total > 0 && r.t.tested === r.t.total);
  const active = open.filter((r) => !finished.includes(r));
  const myWork = active.filter((r) => r.mineLeft > 0);
  const canExecute = can(who, "run:execute");
  // The quest-map offer waits for this test cycle's first result (ver_187): day one is for testing.
  const anyResult = !!(await db.testResult.findFirst({ where: { run: { projectId: project.id } }, select: { id: true } }));
  const monthCounts = trend.buckets.reduce(
    (acc, b) => {
      for (const [s, n] of Object.entries(b.counts)) acc[s as keyof typeof acc] += n;
      return acc;
    },
    countStatuses([]),
  );
  const monthRate = totals(monthCounts).passRate;
  // Flaky: the verdict flipped between passed and failed at least twice lately.
  const flaky = health
    .filter((h) => h.flips >= 2)
    .sort((a, b) => b.flips - a.flips || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, 6);

  // The side boxes with nothing in them, named in one line instead (ver_178).
  const quiet = [myWork.length ? "" : "your work", openBugs.length ? "" : "open bugs", flagged.length ? "" : "flagged cases", flaky.length ? "" : "flaky cases"].filter(Boolean);

  return (
    <div className="page page-list">
      <PageHeader
        title={project.name}
        subtitle={project.description || undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {can(who, "run:create") && <StartRunBox scope={{ projectKey: project.key }} variant={anyGo(active, canExecute) ? "secondary" : "primary"} />}
            {/* Write a bug: for a bug found outside a test. */}
            {canExecute && (
              <LinkButton href={`/p/${project.key}/bugs?write=1`} data-testid="overview-write-bug">
                + Write a bug
              </LinkButton>
            )}
            {/* ver_178: in an umbrella, people are invited on its Members page (the Overview's Start here
                list links there too), so the test cycle has a button instead of a third invite box. */}
            {umbrella && !umbrella.isHub && can(who, "members:manage") && (
              <LinkButton href={`/g/${umbrella.group.id}/settings#members`} data-testid="cycle-invite">
                Invite
              </LinkButton>
            )}
          </div>
        }
      />

      {umbrella && !umbrella.isHub && caseCount > 0 && can(who, "library:move") && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-slate-800">
          <span className="flex-1">
            ☂ This test cycle is part of {umbrella.group.name}. {caseCount === 1 ? "This case is" : `These ${caseCount} cases are`} only here, outside the {umbrella.group.name} case library.
          </span>
          <MoveCasesButton groupId={umbrella.group.id} umbrella={umbrella.group.name} projects={[{ id: project.id, name: project.name, cases: caseCount }]} label={`Move into ${umbrella.group.name}`} />
        </div>
      )}

      {qase && (
        <QaseBar
          projectId={project.id}
          runTitle={project.qaseRunId ? project.qaseRunTitle || `Run ${project.qaseRunId}` : null}
          runUrl={qaseRunUrl(qase.projectCode, project.qaseRunId)}
          syncedAt={project.qaseSyncedAt?.toISOString() ?? null}
          error={project.qaseError}
          canSync={can(who, "run:execute")}
          canChangeRun={can(who, "run:manage")}
        />
      )}

      {can(who, "members:manage") && !(umbrella && !umbrella.isHub) && (
        <InviteTeam
          nudge={(umbrella ? !umbrella.group.rolesChosenAt : !project.rolesChosenAt) && <RolesNudge target={umbrella ? { groupId: umbrella.group.id } : { projectId: project.id }} href={umbrella ? `/g/${umbrella.group.id}/settings#roles` : await cycleSettingsHref(project, user, "roles")} />}
          alone={memberCount === 1}
          projectId={project.id}
          projectName={project.name}
          canEmail={await mailOn()}
          umbrella={umbrella && !project.keepMembersSeparate ? { id: umbrella.group.id, name: umbrella.group.name, hubId: umbrella.hub.id } : null}
        />
      )}

      <div className={cx("mb-5 grid grid-cols-2 gap-3", (explored.length ? 1 : 0) + (liveBash ? 1 : 0) === 2 ? "lg:grid-cols-6" : explored.length || liveBash ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        <Tile label="Runs in progress" value={String(active.length)} href={`/p/${project.key}/runs`} />
        {liveBash && (
          <Tile
            label="Live bug bash"
            value="1"
            note={`${liveBash.name} · ${Math.max(1, Math.round((liveBash.endsAt.getTime() - now.getTime()) / 60000))} min left`}
            href={`/p/${project.key}/bashes/${liveBash.id}`}
          />
        )}
        <Tile label="Pass rate, last 30 days" value={pct(monthRate)} note={`${count(trend.results, "result")}${explored.length ? " · exploring not counted" : ""}`} href={`/p/${project.key}/reports?view=trends`} />
        {explored.length > 0 && (
          <Tile
            label="🧭 Explored, last 30 days"
            value={capitalize(minutesSpent(exploredSec))}
            note={`${explored.length} ${explored.length === 1 ? "session" : "sessions"} · ${exploredFinds.bugs} ${exploredFinds.bugs === 1 ? "bug" : "bugs"} · ${exploredFinds.questions} ${exploredFinds.questions === 1 ? "question" : "questions"}`}
            href={`/p/${project.key}/runs`}
          />
        )}
        <Tile label="Open bugs" value={String(openBugCount)} href={`/p/${project.key}/bugs?status=open`} tone={openBugCount ? "red" : undefined} />
        {/* In an umbrella the runs use the Case library, so count what the cycle can run, not just its own cases. */}
        {umbrella && !umbrella.isHub ? (
          <Tile
            label="Cases it can run"
            value={String(caseCount + libraryCount)}
            note={`from ${umbrella.group.name} case library →`}
            href={`/p/${umbrella.hub.key}/cases`}
          />
        ) : (
          <Tile
            label="Test cases"
            value={String(caseCount)}
            note={flaggedCount ? `${flaggedCount} flagged` : undefined}
            href={`/p/${project.key}/cases${flaggedCount ? "?flagged=1" : ""}`}
          />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <Section title="Runs in progress" more={active.length > 0 ? { href: `/p/${project.key}/runs`, label: "All runs" } : undefined}>
            {active.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">
                <p>{can(who, "run:create") ? "No runs in progress. Press Create a run and it shows here." : "No runs in progress. When someone starts a run, it shows here."}</p>
                {!(user.gameEnabled && user.questMap) && !funOff() && anyResult && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <span>
                      <span className="font-medium text-slate-700">Fun extras:</span> turn every test run into a quest map, with XP, levels and titles.
                    </span>
                    <QuestMapOnButton plain label="Turn on quest maps" />
                  </p>
                )}
              </div>
            ) : (
              <RunsInProgressList rows={active.slice(0, 8)} kinds={kinds} canExecute={canExecute} spelling={spelling} />
            )}
          </Section>

          {finished.length > 0 && (
            <Section title="Finished, ready to close">
              <ul className="divide-y divide-slate-100">
                {finished.map((r) => (
                  <li key={r.number} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <Link href={`/p/${project.key}/runs/${r.number}`} className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:underline">
                      <RunName run={r} spelling={spelling} />
                    </Link>
                    <span className="text-xs text-slate-500">
                      All {r.t.total} cases have a result · {pct(r.t.passRate)} passed
                    </span>
                    {can(who, "run:manage") && <CloseRunButton projectId={project.id} runId={r.id} />}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* The tile above has the number; the chart only shows once there are results to draw. */}
          {trend.results > 0 && (
            <Section title="Pass rate, last 30 days" more={{ href: `/p/${project.key}/reports?view=trends`, label: "Trends" }}>
              <div className="px-4 py-3">
                <PassRateOverTime buckets={trend.buckets} />
              </div>
            </Section>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          {/* ver_178: empty boxes fold into one line, so a new test cycle isn't a wall of "nothing yet". */}
          {quiet.length > 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500" data-testid="cycle-nothing-yet">
              {quiet.length === 4 ? "Nothing needs a look yet. Your work, open bugs, flagged and flaky cases show here when there are some." : `Nothing yet: ${quiet.join(", ")}.`}
            </p>
          )}
          {myWork.length > 0 && (
          <Section title="My work">
            {(
              <ul className="divide-y divide-slate-100">
                {myWork.map((r) => (
                  <li key={r.number}>
                    <Link href={`/p/${project.key}/runs/${r.number}/execute?mine=1`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <span className="min-w-0 truncate text-slate-800">
                        {r.shown === EXPLORE_KIND ? <span aria-hidden>🧭 </span> : r.shown === "rc" ? <span className="font-mono text-xs text-slate-500">RC </span> : null}
                        <RunName run={r} spelling={spelling} />
                      </span>
                      <span className="shrink-0 text-xs font-medium text-accent-700">{r.live?.type === "explore" ? `${r.live.usedMin} of ${r.live.limitMin} min` : `${r.mineLeft} to go`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          )}

          {openBugs.length > 0 && (
          <Section title="Open bugs" more={openBugCount > 0 ? { href: `/p/${project.key}/bugs?status=open`, label: `All ${openBugCount}` } : undefined}>
            {(
              <ul className="divide-y divide-slate-100">
                {openBugs.map((d) => (
                  <li key={d.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-start gap-2">
                      {d.externalUrl ? (
                        <a href={d.externalUrl} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-xs text-accent-700 hover:underline">
                          {d.externalKey ?? `D-${d.number}`}
                        </a>
                      ) : (
                        <span className="shrink-0 font-mono text-xs text-slate-500">{d.externalKey ?? `D-${d.number}`}</span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-slate-800" title={d.title}>
                        {d.title}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {d.externalStatus ?? "Open"} · {d.severity.toLowerCase()} · {relativeTime(d.createdAt, spelling)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          )}

          {flagged.length > 0 && (
          <Section title="Flagged cases" more={flaggedCount > 0 ? { href: `/p/${project.key}/cases?flagged=1`, label: `All ${flaggedCount}` } : undefined}>
            {(
              <ul className="divide-y divide-slate-100">
                {flagged.map((c) => (
                  <li key={c.number}>
                    <Link href={`/p/${project.key}/cases/${c.number}`} className="flex items-start gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <FlagIcon className="mt-0.5 size-3.5 text-orange-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-800">{c.title}</span>
                        <span className="block truncate text-xs text-slate-500" title={c.flagNote || undefined}>
                          {caseKey(project.key, c.number)} · {flagLabel(c.flag)} · {c.flaggedBy} {c.flaggedAt && relativeTime(c.flaggedAt, spelling)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          )}

          {flaky.length > 0 && (
          <Section title="Flaky cases" more={{ href: `/p/${project.key}/reports?view=cases`, label: "Case history" }}>
            {(
              <ul className="divide-y divide-slate-100">
                {flaky.map((c) => (
                  <li key={c.caseKey}>
                    <Link href={`/p/${c.caseProjectKey}/cases/${c.number}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <span className="min-w-0 flex-1 truncate text-slate-800">{c.title}</span>
                      <Badge tone="orange">{c.flips} flips</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, note, href, tone }: { label: string; value: string; note?: string; href: string; tone?: "red" }) {
  return (
    <Link href={href} className="rounded-lg border border-slate-200 bg-surface px-4 py-3 shadow-sm hover:border-slate-300">
      <span className="block text-xs text-slate-500">{label}</span>
      <span className={`mt-1 block text-2xl font-semibold tabular-nums ${tone === "red" ? "text-red-700" : "text-slate-900"}`}>{value}</span>
      {note && <span className="block text-xs text-slate-500">{note}</span>}
    </Link>
  );
}

function Section({ title, more, children }: { title: string; more?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {more && (
          <Link href={more.href} className="text-xs text-accent-700 hover:underline">
            {more.label}
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}
