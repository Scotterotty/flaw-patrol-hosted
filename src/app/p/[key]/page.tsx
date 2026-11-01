import Link from "next/link";
import { FlagIcon } from "@/components/case-flag";
import { StartRunBox } from "@/components/start-run-box";
import { StatusBar } from "@/components/status";
import { PassRateOverTime } from "@/components/trend-charts";
import { Badge, Card, cx, LinkButton, PageHeader } from "@/components/ui";
import { flagLabel } from "@/lib/case-flag";
import { db } from "@/lib/db";
import { mailOn } from "@/lib/mail";
import { caseKey, relativeTime } from "@/lib/format";
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
import { RunKindTag } from "@/components/run-kind-tag";
import { EXPLORE_KIND, parseRunKinds, shownKind } from "@/lib/run-kinds";
import { findsLine, runLive } from "@/lib/run-live";
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
      where: { projectId: project.id, state: "ACTIVE" },
      orderBy: { number: "desc" },
      take: 50,
      select: { id: true, number: true, name: true, kind: true, release: true, createdAt: true, entries: { select: { status: true, assigneeId: true, kind: true } } },
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
    db.testCase.count({ where: { projectId: project.id, archived: false } }),
    trends(project.id, month),
    caseHealth(project.id, { from: new Date(now.getTime() - 90 * DAY), to: now }),
  ]);
  const kinds = parseRunKinds(umbrella?.group.runKinds);
  const live = await runLive(runs.map((r) => r.id), now);
  // 🧭 Explored, last 30 days (ver_96): exploring isn't in the pass rate, so it gets its own tile.
  const explored = await db.testResult.findMany({
    where: { run: { projectId: project.id }, entry: { kind: "EXPLORATORY" }, createdAt: { gte: month.from } },
    select: { elapsedSec: true, sessionLog: true },
  });
  const exploredFinds = explored.reduce((acc, r) => {
    const c = noteCounts(parseSessionLog(r.sessionLog));
    return { bugs: acc.bugs + c.bug, questions: acc.questions + c.question };
  }, { bugs: 0, questions: 0 });
  const exploredMin = Math.round(explored.reduce((n, r) => n + (r.elapsedSec ?? 0), 0) / 60);
  const libraryCount = umbrella && !umbrella.isHub ? await db.testCase.count({ where: { projectId: umbrella.hub.id, archived: false } }) : 0;

  const open = runs.map((r) => {
    const counts = countStatuses(r.entries.map((e) => e.status));
    const mine = r.entries.filter((e) => e.assigneeId === user.id);
    return { ...r, counts, t: totals(counts), mineLeft: mine.filter((e) => isOpen(e.status)).length, mine: mine.length, shown: shownKind(r), live: live.get(r.id) };
  });
  // A run where every case has a result is finished; it only waits for someone to close it.
  const finished = open.filter((r) => r.t.total > 0 && r.t.tested === r.t.total);
  const active = open.filter((r) => !finished.includes(r));
  const myWork = active.filter((r) => r.mineLeft > 0);
  const canExecute = can(who, "run:execute");
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

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={project.name}
        subtitle={project.description || "Overview"}
        actions={can(who, "run:create") && <StartRunBox scope={{ projectKey: project.key }} />}
      />

      {umbrella && !umbrella.isHub && caseCount > 0 && can(who, "library:move") && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-slate-800">
          <span className="flex-1">
            ☂ This test cycle is part of {umbrella.group.name}. {caseCount === 1 ? "This case is" : `These ${caseCount} cases are`} only here, outside the {umbrella.group.name} case library.
          </span>
          <MoveCasesButton groupId={umbrella.group.id} umbrella={umbrella.group.name} projects={[{ id: project.id, name: project.name, cases: caseCount }]} label={`Move into ${umbrella.group.name}`} />
        </div>
      )}

      {can(who, "members:manage") && (
        <InviteTeam
          nudge={(umbrella ? !umbrella.group.rolesChosenAt : !project.rolesChosenAt) && <RolesNudge target={umbrella ? { groupId: umbrella.group.id } : { projectId: project.id }} href={umbrella ? `/g/${umbrella.group.id}/settings#roles` : await cycleSettingsHref(project, user, "roles")} />}
          alone={memberCount === 1}
          projectId={project.id}
          projectName={project.name}
          canEmail={await mailOn()}
          umbrella={umbrella && !project.keepMembersSeparate ? { id: umbrella.group.id, name: umbrella.group.name, hubId: umbrella.hub.id } : null}
        />
      )}

      <div className={cx("mb-5 grid grid-cols-2 gap-3", explored.length ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        <Tile label="Runs in progress" value={String(active.length)} href={`/p/${project.key}/runs`} />
        <Tile label="Pass rate, last 30 days" value={pct(monthRate)} note={`${trend.results} results${explored.length ? " · exploring not counted" : ""}`} href={`/p/${project.key}/reports?view=trends`} />
        {explored.length > 0 && (
          <Tile
            label="🧭 Explored, last 30 days"
            value={exploredMin >= 60 ? `${Math.floor(exploredMin / 60)} h ${exploredMin % 60} min` : `${exploredMin} min`}
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
                <p>No runs in progress. Press Start a run and it shows here.</p>
                {!(user.gameEnabled && user.questMap) && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <span>
                      <span className="font-medium text-slate-700">Fun extras:</span> turn every test run into a quest map, with XP, levels and titles.
                    </span>
                    <QuestMapOnButton size="sm" />
                  </p>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {active.slice(0, 8).map((r) => {
                  const lv = r.live;
                  const button =
                    lv?.type === "bash"
                      ? lv.live && { href: `/p/${lv.homeKey}/bashes/${lv.bashId}?join=1`, label: "Join the bash" }
                      : lv?.type === "explore"
                        ? canExecute && { href: `/p/${project.key}/runs/${r.number}/execute`, label: lv.started ? "Keep exploring" : "Start exploring" }
                        : canExecute && r.t.tested < r.t.total && { href: `/p/${project.key}/runs/${r.number}/execute${r.mineLeft ? "?mine=1" : ""}`, label: r.t.tested === 0 ? "Start testing" : "Resume" };
                  return (
                    <li key={r.number} className="relative px-4 py-3 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          href={`/p/${project.key}/runs/${r.number}`}
                          className="min-w-0 truncate font-medium text-slate-900 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent-500 focus-visible:after:ring-inset"
                        >
                          <span className="font-mono text-xs text-slate-500">R{r.number}</span> {r.name}
                        </Link>
                        <span className="relative z-10 flex shrink-0 items-center gap-2">
                          <RunKindTag kinds={kinds} kind={r.shown} live={lv?.type === "bash" && lv.live} />
                          {button && (
                            <LinkButton size="sm" variant="primary" href={button.href} aria-label={`${button.label} R${r.number} ${r.name}`}>
                              {button.label}
                            </LinkButton>
                          )}
                        </span>
                      </div>
                      {lv?.type === "explore" ? (
                        <>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                            <div className="h-full rounded-full bg-teal-600" style={{ width: `${lv.limitMin ? Math.min(100, (lv.usedMin / lv.limitMin) * 100) : 0}%` }} />
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {lv.started ? (
                              <>
                                <span className="tabular-nums">
                                  {lv.usedMin} of {lv.limitMin} min
                                </span>
                                {lv.who && ` · ${lv.who}`}
                                {lv.persona && ` · as ${lv.persona.emoji} ${lv.persona.name}`} · {findsLine(lv)}
                              </>
                            ) : (
                              <>
                                Not started · {lv.limitMin} min limit{lv.persona && ` · as ${lv.persona.emoji} ${lv.persona.name}`}
                              </>
                            )}
                          </p>
                        </>
                      ) : lv?.type === "bash" ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {lv.live && <span className="font-medium text-rose-700">{lv.minutesLeft} min left · </span>}
                          {lv.people} {lv.people === 1 ? "person" : "people"} exploring · {lv.bugs} {lv.bugs === 1 ? "bug" : "bugs"} logged · {lv.areas} {lv.areas === 1 ? "area" : "areas"} · started {relativeTime(lv.startedAt, spelling)}
                        </p>
                      ) : (
                        <>
                          <StatusBar counts={r.counts} className="mt-2" />
                          <p className="mt-1 text-xs text-slate-500">
                            <span className="tabular-nums">
                              {r.t.tested} of {r.t.total} tested · {pct(r.t.passRate)} passed
                            </span>
                            {r.release && ` · ${r.release}`} · started {relativeTime(r.createdAt, spelling)}
                            {r.mine > 0 && ` · ${r.mineLeft ? `${r.mineLeft} of yours to go` : "your cases are done"}`}
                          </p>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {finished.length > 0 && (
            <Section title="Finished, ready to close">
              <ul className="divide-y divide-slate-100">
                {finished.map((r) => (
                  <li key={r.number} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <Link href={`/p/${project.key}/runs/${r.number}`} className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:underline">
                      <span className="font-mono text-xs text-slate-500">R{r.number}</span> {r.name}
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

          <Section title="Pass rate, last 30 days" more={{ href: `/p/${project.key}/reports?view=trends`, label: "Trends" }}>
            <div className="px-4 py-3">
              <PassRateOverTime buckets={trend.buckets} />
            </div>
          </Section>
        </div>

        <div className="min-w-0 space-y-5">
          <Section title="My work">
            {myWork.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">Nothing assigned to you is waiting.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {myWork.map((r) => (
                  <li key={r.number}>
                    <Link href={`/p/${project.key}/runs/${r.number}/execute?mine=1`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <span className="min-w-0 truncate text-slate-800">
                        {r.shown === EXPLORE_KIND ? <span aria-hidden>🧭 </span> : <span className="font-mono text-xs text-slate-500">{r.shown === "rc" ? "RC" : `R${r.number}`}</span>} {r.name}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-accent-700">{r.live?.type === "explore" ? `${r.live.usedMin} of ${r.live.limitMin} min` : `${r.mineLeft} to go`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Open bugs" more={openBugCount > 0 ? { href: `/p/${project.key}/bugs?status=open`, label: `All ${openBugCount}` } : undefined}>
            {openBugs.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">No open bugs.</p>
            ) : (
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

          <Section title="Flagged cases" more={flaggedCount > 0 ? { href: `/p/${project.key}/cases?flagged=1`, label: `All ${flaggedCount}` } : undefined}>
            {flagged.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">No cases are flagged for attention.</p>
            ) : (
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

          <Section title="Flaky cases" more={flaky.length > 0 ? { href: `/p/${project.key}/reports?view=cases`, label: "Case history" } : undefined}>
            {flaky.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">No case has flipped between passing and failing in the last 90 days.</p>
            ) : (
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
