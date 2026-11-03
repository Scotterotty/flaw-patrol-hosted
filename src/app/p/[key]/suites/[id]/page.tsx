import { CrumbName } from "@/components/crumb-name";
import { PaneResizer } from "@/components/pane-resizer";
import { runFieldsFor } from "@/lib/run-fields-server";
import type { ResultStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriorityBadge, TypeBadge } from "@/components/badges";
import { NewRunButton } from "@/components/new-run";
import { StartRunBox } from "@/components/start-run-box";
import { HistoryStrip, StatusBar, StatusChip } from "@/components/status";
import { MoreMenu } from "@/components/more-menu";
import { ArchiveSuiteButton, RenameSuiteButton } from "@/components/suite-actions";
import { Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { db } from "@/lib/db";
import { caseKey, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { projectAccess, mySpelling } from "@/lib/session";
import { hubGroupId, libraryProjectIds } from "@/lib/umbrella";
import { countStatuses, isOpen, pct, STATUSES, totals } from "@/lib/status";
import { projectMembers } from "@/lib/suite-data";
import { sortCases } from "@/lib/case-sort";
import { readCaseSort } from "@/lib/case-sort-server";
import { CaseSortToggle } from "@/components/case-sort-toggle";

export const metadata = { title: "Test suite" };

export default async function SuitePage({ params, searchParams }: { params: Promise<{ key: string; id: string }>; searchParams: Promise<{ start?: string }> }) {
  const spelling = await mySpelling();
  const { key, id } = await params;
  const startNow = (await searchParams).start === "1";
  const { project, user, who } = await projectAccess(key);
  // A project under an umbrella also runs the umbrella's shared suites; they're edited in the umbrella.
  const library = await libraryProjectIds(project);
  const suite = await db.testSuite.findFirst({
    where: { id, projectId: { in: library } },
    include: {
      project: { select: { key: true, name: true } },
      cases: { orderBy: { position: "asc" }, include: { testCase: { select: { id: true, number: true, title: true, priority: true, archived: true, type: true, project: { select: { key: true } } } } } },
      runs: { where: { projectId: project.id }, orderBy: { number: "desc" }, take: 20, include: { entries: { select: { caseId: true, status: true } } } },
      versions: { orderBy: { version: "desc" } },
    },
  });
  if (!suite) notFound();
  const shared = suite.projectId !== project.id;
  // The umbrella's own suites run in its test cycles, picked in the Start a run box.
  const hubOf = await hubGroupId(project.id);
  const umbrellaName = shared ? ((await db.project.findUnique({ where: { id: project.id }, select: { group: { select: { name: true } } } }))?.group?.name ?? suite.project.name) : "";
  // Shared suites can be run here but not changed here.
  const manage = can(who, "suite:manage") && !shared;
  const members = await projectMembers(project.id);
  // For the Rename box: the project's other suite names (same-name warning) and, for an umbrella's
  // own suite, how many test cycles also run it.
  const otherNames = manage
    ? (await db.testSuite.findMany({ where: { projectId: project.id, id: { not: suite.id } }, select: { name: true } })).map((s) => s.name)
    : [];
  const sharedWith = manage && hubOf ? await db.project.count({ where: { groupId: hubOf, archivedAt: null, id: { not: project.id } } }) : 0;
  const rename = { projectId: project.id, suiteId: suite.id, name: suite.name, otherNames, sharedWith };
  // Every run of this suite, grouped by release, for the RC table.
  const allRuns = await db.testRun.findMany({
    where: { suiteId: suite.id, projectId: project.id },
    orderBy: { number: "desc" },
    select: { id: true, number: true, release: true, suiteVersion: true, build: true, createdAt: true, entries: { select: { status: true } } },
  });
  const byRelease = new Map<string, typeof allRuns>();
  for (const r of allRuns) {
    const k = r.release || "";
    byRelease.set(k, [...(byRelease.get(k) ?? []), r]);
  }
  const releases = [...new Set(allRuns.map((r) => r.release).filter(Boolean))];

  // Per case: statuses across this suite's runs, oldest first.
  const history = new Map<string, { status: ResultStatus; title: string; href: string }[]>();
  for (const run of [...suite.runs].reverse()) {
    for (const e of run.entries) {
      if (isOpen(e.status)) continue;
      const list = history.get(e.caseId) ?? [];
      list.push({ status: e.status, title: `R${run.number}: ${e.status.toLowerCase()}`, href: `/p/${project.key}/runs/${run.number}` });
      history.set(e.caseId, list);
    }
  }
  // Last result: each case's latest result from any run in the test cycle's umbrella (or the
  // test cycle itself), not just this suite's runs, named small underneath.
  const scope = project.groupId ? { project: { groupId: project.groupId } } : { projectId: project.id };
  const lastAnywhere = await db.runEntry.findMany({
    where: { caseId: { in: suite.cases.map((c) => c.caseId) }, status: { notIn: STATUSES.filter(isOpen) }, lastTestedAt: { not: null }, run: scope },
    orderBy: { lastTestedAt: "desc" },
    distinct: ["caseId"],
    select: { caseId: true, status: true, lastTestedAt: true, run: { select: { number: true, name: true, project: { select: { key: true, name: true, group: { select: { name: true } } } } } } },
  });
  const lastOf = new Map(lastAnywhere.map((e) => [e.caseId, e]));
  const cycleName = (p: { name: string; group: { name: string } | null }) => (p.group && p.name.startsWith(`${p.group.name} `) ? p.name.slice(p.group.name.length + 1) : p.name);
  const latest = suite.runs[0];
  const latestCounts = latest ? countStatuses(latest.entries.map((e) => e.status)) : null;
  const activeCases = suite.cases.filter((c) => !c.testCase.archived);
  const sort = await readCaseSort();
  const shownCases = sortCases(
    suite.cases.map((sc, i) => ({ sc, position: i + 1 })),
    sort,
    (c) => c.sc.testCase.priority,
  );

  return (
    <div className="mx-auto max-w-6xl">
      <CrumbName href={`/p/${project.key}/suites/${suite.id}`} label={suite.name} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {suite.name} {suite.archived && <Badge tone="orange">Archived</Badge>}
            </h1>
            {manage && <RenameSuiteButton {...rename} look="pencil" />}
          </div>
          {shared && (
            <p className="mt-1 text-sm text-accent-700">
              Shared suite from {umbrellaName}.{" "}
              <Link href={`/p/${suite.project.key}/suites/${suite.id}`} className="underline">
                Edit it in {umbrellaName}
              </Link>
            </p>
          )}
          <p className="mt-1 text-sm text-slate-500">
            Version {suite.currentVersion} · {activeCases.length} {activeCases.length === 1 ? "case" : "cases"}{suite.description ? ` · ${suite.description}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manage && (
            <>
              <MoreMenu>
                <RenameSuiteButton {...rename} look="menu" />
                {can(who, "library:archive") && <ArchiveSuiteButton projectId={project.id} suiteId={suite.id} archived={suite.archived} />}
              </MoreMenu>
              <LinkButton href={`/p/${project.key}/suites/${suite.id}/edit`}>Edit cases</LinkButton>
            </>
          )}
          {can(who, "run:create") && !suite.archived && hubOf && (
            <StartRunBox scope={{ groupId: hubOf }} preset={{ what: "suite", suiteId: suite.id }} label="Start test run…" disabled={activeCases.length === 0} initialOpen={startNow} />
          )}
          {can(who, "run:create") && !suite.archived && !hubOf && (
            <NewRunButton
              meId={user.id}
              projectId={project.id}
              projectKey={project.key}
              source={{ kind: "suite", suiteId: suite.id }}
              defaultName={`${suite.name} ${new Date().toISOString().slice(0, 10)}`}
              members={members}
              suggest={latest ? { from: `R${latest.number}`, environment: latest.environment, release: latest.release } : undefined}
              disabled={activeCases.length === 0}
              releases={releases}
              suiteVersion={suite.currentVersion}
              initialOpen={startNow}
              fields={await runFieldsFor(project.id)}
              autoCases={activeCases.filter((c) => c.testCase.type === "AUTOMATED").length}
            />
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_var(--fp-pane,20rem)]">
        <Card className="overflow-hidden">
          {suite.cases.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="This suite has no cases"
                action={manage ? <LinkButton href={`/p/${project.key}/suites/${suite.id}/edit`}>Add cases</LinkButton> : null}
              />
            </div>
          ) : (
            <>
            <div className="flex justify-end border-b border-slate-200 px-3 py-2">
              <CaseSortToggle value={sort} orderLabel="Suite order" />
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Case</th>
                  <th className="w-20 px-3 py-2 font-medium">Priority</th>
                  <th className="w-48 px-3 py-2 font-medium">Last result</th>
                  <th className="hidden w-32 px-3 py-2 font-medium md:table-cell">History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shownCases.map(({ sc, position }) => {
                  const h = history.get(sc.caseId) ?? [];
                  const last = lastOf.get(sc.caseId);
                  return (
                    <tr key={sc.caseId} className={sc.testCase.archived ? "opacity-50" : ""}>
                      <td className="px-3 py-2 text-xs text-slate-400 tabular-nums">{position}</td>
                      <td className="px-3 py-2">
                        <Link href={`/p/${sc.testCase.project.key}/cases/${sc.testCase.number}`} className="hover:underline">
                          <span className="font-mono text-xs text-slate-500">{caseKey(sc.testCase.project.key, sc.testCase.number)}</span> {sc.testCase.title}
                        </Link>
                        {sc.testCase.archived && <span className="ml-1 text-xs text-slate-400">(archived, skipped in new runs)</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex flex-wrap gap-1">
                          <PriorityBadge priority={sc.testCase.priority} />
                          {sc.testCase.type === "EXPLORATORY" && <TypeBadge type="EXPLORATORY" />}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {last ? (
                          <>
                            <StatusChip status={last.status} />
                            <Link
                              href={`/p/${last.run.project.key}/runs/${last.run.number}`}
                              className="mt-0.5 block text-[11px] leading-snug text-slate-500 hover:underline"
                              data-testid="last-result-run"
                            >
                              R{last.run.number} {last.run.name} · {cycleName(last.run.project)} · {relativeTime(last.lastTestedAt!, spelling)}
                            </Link>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">Not run</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <HistoryStrip statuses={h} max={10} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </>
          )}
        </Card>
        <aside className="relative space-y-4">
          <PaneResizer id="suite-side" label="the side panel" min={224} max={480} target="parent" edge="left" />
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Releases tested</h2>
            {byRelease.size === 0 ? (
              <p className="text-sm text-slate-500">No runs yet.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="pb-1 font-medium">Release</th>
                    <th className="pb-1 font-medium">Suite</th>
                    <th className="pb-1 font-medium">Runs</th>
                    <th className="pb-1 text-right font-medium">Passed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...byRelease.entries()].map(([rc, runs]) => {
                    const c = countStatuses(runs[0].entries.map((e) => e.status));
                    const versions = [...new Set(runs.map((r) => r.suiteVersion).filter((v): v is number => v !== null))].sort((a, b) => a - b);
                    return (
                      <tr key={rc || "none"}>
                        <td className="py-1.5 font-medium text-slate-800">
                          <Link href={`/p/${project.key}/reports?release=${encodeURIComponent(rc)}`} className="hover:underline">
                            {rc || <span className="font-normal text-slate-400">(none)</span>}
                          </Link>
                        </td>
                        <td className="py-1.5 text-slate-600">{versions.length ? versions.map((v) => `v${v}`).join(", ") : "–"}</td>
                        <td className="py-1.5 text-slate-600">
                          {runs.map((r, i) => (
                            <span key={r.id}>
                              {i > 0 && ", "}
                              <Link href={`/p/${project.key}/runs/${r.number}`} className="hover:underline">
                                R{r.number}
                              </Link>
                            </span>
                          ))}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-slate-700" title="Latest run for this release">
                          {pct(totals(c).passRate)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Runs of this suite</h2>
            {suite.runs.length === 0 ? (
              <p className="text-sm text-slate-500">No runs yet.</p>
            ) : (
              <ul className="space-y-3">
                {suite.runs.map((r) => {
                  const c = countStatuses(r.entries.map((e) => e.status));
                  const t = totals(c);
                  return (
                    <li key={r.id}>
                      <Link href={`/p/${project.key}/runs/${r.number}`} className="block hover:underline">
                        <span className="text-sm font-medium text-slate-800">R{r.number}</span>{" "}
                        <span className="text-sm text-slate-600">{r.name}</span>
                      </Link>
                      <StatusBar counts={c} className="mt-1" />
                      <p className="mt-0.5 text-xs text-slate-500">
                        {relativeTime(r.createdAt, spelling)}
                        {r.release && ` · ${r.release}`}
                        {r.suiteVersion && ` · suite v${r.suiteVersion}`} · {pct(t.passRate)} passed · {Math.round(t.progress * 100)}% done
                        {r.state === "COMPLETED" && " · closed"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Suite versions</h2>
            <ol className="space-y-2 text-sm">
              {suite.versions.map((v) => (
                <li key={v.id}>
                  <span className="font-medium text-slate-800">Version {v.version}</span>
                  {v.version === suite.currentVersion && <span className="ml-1.5 text-xs text-emerald-700">current</span>}
                  <p className="text-xs text-slate-500">
                    {(v.caseIds as string[]).length} {(v.caseIds as string[]).length === 1 ? "case" : "cases"} · {v.authorName} · {relativeTime(v.createdAt, spelling)}
                  </p>
                  {v.changeNote && <p className="text-xs text-slate-600">{v.changeNote}</p>}
                </li>
              ))}
            </ol>
          </Card>
          {latestCounts && (
            <p className="px-1 text-xs text-slate-500">History shows each case&apos;s result in the suite&apos;s last {suite.runs.length} runs, oldest on the left.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
