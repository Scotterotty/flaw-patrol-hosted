import type { ResultStatus } from "@prisma/client";
import { runTitle } from "@/lib/run-label";
import { RunName } from "@/components/run-name";
import { titleWithTags } from "@/lib/tags";
import { tagColorsFor } from "@/lib/tag-data";
import { sentryConnected } from "@/lib/sentry-config";
import { SentryCard } from "@/components/sentry-card";
import { headingRows } from "@/lib/step-checks";
import { Fragment } from "react";
import { CrumbName } from "@/components/crumb-name";
import Link from "next/link";
import { notFound } from "next/navigation";
import { startTiming } from "@/lib/timing";
import { EditRunButton } from "@/components/edit-run";
import { MoreMenu } from "@/components/more-menu";
import { NewRunButton } from "@/components/new-run";
import { CloseRunButton, RunStateButtons } from "@/components/run-actions";
import { SlackBell } from "@/components/slack-bell";
import { slackSummaryFor } from "@/lib/slack";
import { alertSummary } from "@/lib/slack-alerts";
import { LiveRefresh } from "@/components/live-refresh";
import { HandOffNote } from "@/components/hand-off-note";
import { AutomatedRun } from "./automated-run";
import { queueQasePull } from "@/lib/qase-sync";
import { RunEntries } from "@/components/run-entries";
import { ClientGrid } from "@/components/client-grid";
import { clientGridEntry } from "@/lib/client-grid-data";
import { liveRowOf } from "@/lib/live-rows-data";
import { flakyCases } from "@/lib/flaky";
import { RunSheetButton, RunSheetStatus, type SheetState } from "@/components/run-sheet";
import { StatusBar } from "@/components/status";
import { Badge, buttonClass, cx, LinkButton } from "@/components/ui";
import { db } from "@/lib/db";
import { caseKey, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { SHEETS_ENABLED } from "@/lib/features";
import { fillWords } from "@/lib/sheet-fill";
import { projectAccess, mySpelling } from "@/lib/session";
import { cycleSettingsHref } from "@/lib/umbrella";
import { countStatuses, pct, STATUS_LABEL, totals } from "@/lib/status";
import { projectMembers } from "@/lib/suite-data";
import { sortCases } from "@/lib/case-sort";
import { readCaseSort } from "@/lib/case-sort-server";
import { releaseOptions } from "@/lib/reports";
import { fieldBits, parseFieldValues } from "@/lib/run-fields";
import { runFieldsFor } from "@/lib/run-fields-server";
import { runRegressions } from "@/lib/regression-data";
import { againstLabel, regressionTip } from "@/lib/regression";
import { CompareWith } from "@/components/regression";
import { knownBugsForRun } from "@/lib/known-bugs";
import { caseNewsForRun } from "@/lib/case-news-data";
import { shortDate } from "@/lib/spelling";
import { KnownBugsPanel, type RunKnown } from "@/components/known-bugs-panel";
import { RunSummary } from "@/components/run-summary";
import { shortNames } from "@/lib/short-names";
import { viewerZone } from "@/lib/zone-server";

export const metadata = { title: "Test run" };

export default async function RunPage({ params, searchParams }: { params: Promise<{ key: string; number: string }>; searchParams: Promise<{ handed?: string; compare?: string; updated?: string; assigned?: string; view?: string }> }) {
  // FP_TIMING=1 prints how long each part took. The independent lookups run side by
  // side instead of one after another, so the page shows sooner after Start.
  const timing = startTiming("Run page");
  // Live rows read after this replace the list's rows straight away.
  const renderedAt = Date.now();
  const { key, number } = await params;
  const { handed, compare, updated, assigned, view } = await searchParams;
  const [spelling, { project, user, who }] = await Promise.all([mySpelling(), timing.step("sign-in and project", projectAccess(key))]);
  const zone = await viewerZone();
  const n = Number(number);
  if (!Number.isInteger(n)) notFound();
  const run = await timing.step("run and its cases", db.testRun.findUnique({
    where: { projectId_number: { projectId: project.id, number: n } },
    include: {
      suite: { select: { id: true, name: true, project: { select: { key: true } }, versions: { select: { version: true, name: true } } } },
      entries: {
        orderBy: { position: "asc" },
        include: {
          testCase: { select: { number: true, tags: true, project: { select: { key: true } } } },
          // The last saved result's steps, so finished cases keep their pips.
          results: { orderBy: { createdAt: "desc" }, take: 1, select: { stepResults: true, testerName: true, testerId: true, createdAt: true, fromQase: true } },
        },
      },
    },
  }));
  if (!run) notFound();
  // Qase: opening a run brings in its test cycle's Qase results, at most once a minute.
  if (run.kind !== "bash" && project.groupId) queueQasePull(project.id);
  // A suite renamed since this run shows the name the run used, next to today's name.
  const ranAs = run.suite && run.suiteVersion ? run.suite.versions.find((v) => v.version === run.suiteVersion)?.name : undefined;
  const thenCalled = ranAs && ranAs !== run.suite?.name ? ranAs : null;
  if (run.automated) return <AutomatedRun project={project} runId={run.id} who={who} />;
  const entryRefs = run.entries.map((e) => ({ id: e.id, caseId: e.caseId, steps: e.steps }));
  const [members, defectLinks, releases, sort, runFields, knownMap, news, slack, flaky, reg, sentryOn, tagColors] = await Promise.all([
    timing.step("members", projectMembers(project.id)),
    timing.step("bugs filed", db.defectLink.findMany({
      where: { result: { runId: run.id } },
      include: { defect: true, result: { select: { entryId: true } } },
    })),
    timing.step("releases", releaseOptions(project.id)),
    readCaseSort(),
    timing.step("run fields", runFieldsFor(project.id)),
    // Known bugs from earlier runs, for runs tested by hand.
    timing.step("known bugs", knownBugsForRun(run.id, entryRefs)),
    timing.step("new and updated cases", caseNewsForRun(run, run.entries)),
    timing.step("Slack", slackSummaryFor(project.id)),
    timing.step("flaky cases", flakyCases({ caseIds: [...new Set(run.entries.map((e) => e.caseId))] })),
    // Regression flag: cases that passed last release on this platform and fail now.
    timing.step("regressions", runRegressions(run, project, compare)),
    timing.step("Sentry", sentryConnected(project.id)),
    timing.step("tags", tagColorsFor(project.id)),
  ]);
  timing.done();

  // Clients (ver_214): a run started with clients opens on the client grid.
  const byClient = run.clients.length > 0 && run.entries.some((e) => e.clients.length > 0);
  const counts = countStatuses(run.entries.map((e) => e.status));
  const t = totals(counts);
  const defectsByEntry = new Map<string, Set<string>>();
  for (const l of defectLinks) {
    const s = defectsByEntry.get(l.result.entryId) ?? new Set();
    s.add(l.defectId);
    defectsByEntry.set(l.result.entryId, s);
  }
  const defects = [...new Map(defectLinks.map((l) => [l.defectId, l.defect])).values()];
  const knownList: RunKnown[] = run.entries.flatMap((e) => (knownMap.get(e.id) ?? []).map((bug) => ({ bug, caseKey: caseKey(e.testCase.project.key, e.testCase.number) })));
  // Step counts from each case's last saved result. Heading rows in shared steps take no result, so they don't count.
  const steps: Partial<Record<ResultStatus, number>> = {};
  let stepTotal = 0;
  for (const e of run.entries) {
    const headings = headingRows(e.steps);
    // A case with only a title runs as one step.
    if (Array.isArray(e.steps) && e.steps.length) stepTotal += e.steps.length - headings.size;
    else if (e.kind !== "EXPLORATORY") stepTotal += 1;
    const saved = e.results[0]?.stepResults;
    if (Array.isArray(saved))
      saved.forEach((r, i) => {
        const status = (r as { status?: ResultStatus } | null)?.status;
        if (status && !headings.has(i)) steps[status] = (steps[status] ?? 0) + 1;
      });
  }
  const byTester = members
    .map((m) => {
      const mine = run.entries.filter((e) => e.assigneeId === m.id);
      return { ...m, counts: countStatuses(mine.map((e) => e.status)), total: mine.length };
    })
    .filter((m) => m.total > 0);
  const unassigned = run.entries.filter((e) => !e.assigneeId);
  // First names in the list, "You" for your own cases (ver_200).
  const names = shortNames(members, user.id);
  const sheet: SheetState = {
    hook: run.sheetHook,
    tab: run.sheetTab,
    auto: run.sheetAuto,
    link: run.sheetLink,
    syncedAgo: run.sheetSyncedAt && relativeTime(run.sheetSyncedAt, spelling),
    error: run.sheetError,
    mode: run.sheetMode === "fill" ? "fill" : "tab",
    fills: fillWords(run.sheetFill),
    note: run.sheetNote,
  };
  const failedish = run.entries.filter((e) => ["FAILED", "BLOCKED", "RETEST"].includes(e.status)).length;
  // "Retest 3 not passed" says what's in it on hover: 1 failed · 1 blocked.
  const notPassed = (["FAILED", "BLOCKED", "RETEST"] as const)
    .map((s) => [s, run.entries.filter((e) => e.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${STATUS_LABEL[s].toLowerCase()}`)
    .join(" · ");
  // Every case has a result: the run only needs closing.
  const finished = run.state === "ACTIVE" && t.total > 0 && t.tested === t.total;
  // Just started and handed to someone else: a link to send them.
  // Import results from a sheet: open runs you test by hand, for whoever can bring in results.
  const fromSheet = run.state === "ACTIVE" && run.kind !== "bash" && can(who, "run:import");
  const updatedCount = Math.max(0, Math.floor(Number(updated) || 0));
  const assignedCount = Math.max(0, Math.floor(Number(assigned) || 0));
  const handedTo = handed ? members.find((m) => m.id === handed) : undefined;
  const handedCases = handedTo ? run.entries.filter((e) => e.assigneeId === handedTo.id).length : 0;

  // Clients: the grid, or the usual case list (assign, take out, sort...).
  const viewSwitch = byClient && (
        <nav aria-label="How to show the cases" className="inline-flex rounded-lg border border-slate-300 bg-surface p-0.5 text-sm" data-testid="client-view-switch">
          {(
            [
              ["", "By client"],
              ["list", "Case list"],
            ] as const
          ).map(([v, label]) => (
            <Link
              key={v || "grid"}
              href={`/p/${project.key}/runs/${run.number}${v ? `?view=${v}` : ""}`}
              aria-current={(view === "list") === (v === "list") ? "page" : undefined}
              className={cx("rounded-md px-3 py-1", (view === "list") === (v === "list") ? "bg-accent-600 font-medium text-white" : "text-slate-700 hover:bg-slate-100")}
            >
              {label}
            </Link>
          ))}
        </nav>
  );

  return (
    <div className="max-w-6xl">
      <LiveRefresh url={`/api/live/runs/${run.id}`} rows renderedAt={renderedAt} />
      <CrumbName href={`/p/${project.key}/runs/${run.number}`} label={runTitle(run, spelling)} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="fp-name flex items-center gap-2 text-xl tracking-tight">
            <RunName run={run} spelling={spelling} className="font-mono text-base font-normal text-slate-500" />
            {run.state === "COMPLETED" && <Badge tone="gray">Closed</Badge>}
            {!run.build.trim() && can(who, "run:create") && (
              <EditRunButton
                addVersion
                projectId={project.id}
                runId={run.id}
                details={{ name: run.name, release: run.release, build: run.build, cspVersion: run.cspVersion, environment: run.environment, description: run.description, fields: parseFieldValues(run.fields) }}
                releases={releases}
                fields={runFields}
              />
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {[
              run.release && `Release ${run.release}`,
              run.suite && (
                <Link key="suite" href={`/p/${run.suite.project.key}/suites/${run.suite.id}`} className="hover:underline">
                  {run.suite.name}
                  {run.suiteVersion ? ` v${run.suiteVersion}` : ""}
                  {thenCalled && <span data-testid="suite-then-called"> (then called {thenCalled})</span>}
                </Link>
              ),
              ...fieldBits(run),
              run.environment,
              `started ${relativeTime(run.createdAt, spelling)} by ${run.createdBy}`,
            ]
              .filter(Boolean)
              .map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && " · "}
                  {part}
                </Fragment>
              ))}
          </p>
          {run.description && <p className="mt-1 text-sm whitespace-pre-line text-slate-600">{run.description}</p>}
          {SHEETS_ENABLED && <RunSheetStatus projectId={project.id} runId={run.id} sheet={sheet} />}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {slack.length > 0 && (
            <SlackBell
              channels={slack.map((c) => ({ name: c.name, what: alertSummary(c.alerts) }))}
              href={can(who, "jira:manage") ? (project.groupId && project.slackMode === "umbrella" ? `/g/${project.groupId}/settings#slack` : await cycleSettingsHref(project, user, "slack")) : null}
            />
          )}
          {/* ver_203: import and export get their own gray button, away from Close run and Delete.
              Viewers see only the Export lines, and the button then just says Export. */}
          {(fromSheet || SHEETS_ENABLED) && (
            <MoreMenu label={fromSheet ? "Import / Export" : "Export"} howto="run-import-export">
              {fromSheet && (
                // ver_177: bring a spreadsheet's results into this run, where people already are.
                <Link href={`/p/${project.key}/runs/import?run=${run.number}`} className={buttonClass("ghost")} data-howto="run-update-sheet">
                  Import results from a sheet
                </Link>
              )}
              {SHEETS_ENABLED && (
                <a href={`/p/${project.key}/runs/${run.number}/export`} download className={buttonClass("ghost")} data-howto="run-export">
                  Export to Excel (.xlsx)
                </a>
              )}
              {SHEETS_ENABLED && can(who, "run:create") && <RunSheetButton projectId={project.id} runId={run.id} runName={run.name} sheet={sheet} />}
            </MoreMenu>
          )}
          {(can(who, "run:create") || can(who, "run:manage") || can(who, "run:delete")) && (
            <MoreMenu howto="run-more">
              {can(who, "run:create") && (
                <EditRunButton
                  projectId={project.id}
                  runId={run.id}
                  details={{ name: run.name, release: run.release, build: run.build, cspVersion: run.cspVersion, environment: run.environment, description: run.description, fields: parseFieldValues(run.fields) }}
                  releases={releases}
                  fields={runFields}
                />
              )}
              {(can(who, "run:manage") || can(who, "run:delete")) && <RunStateButtons projectId={project.id} projectKey={project.key} runId={run.id} state={run.state} canClose={can(who, "run:manage")} canDelete={can(who, "run:delete")} />}
            </MoreMenu>
          )}
          {can(who, "run:create") && failedish > 0 && (
            <span title={notPassed} className="contents">
            <NewRunButton
              meId={user.id}
              projectId={project.id}
              projectKey={project.key}
              source={{ kind: "rerun", runId: run.id, statuses: ["FAILED", "BLOCKED", "RETEST"] }}
              defaultName={`${run.name} (retest)`}
              members={members}
              label={`Retest ${failedish} not passed`}
              data-howto="run-retest"
              variant="secondary"
              suggest={{ from: runTitle(run, spelling), environment: run.environment, release: run.release }}
              fields={runFields}
            />
            </span>
          )}
          {run.state === "ACTIVE" && can(who, "run:execute") && !finished && (
            <LinkButton variant="primary" href={`/p/${project.key}/runs/${run.number}/execute`} data-howto="run-start-testing">
              {t.tested === 0 ? "Start testing" : "Continue testing"}
            </LinkButton>
          )}
          {finished && can(who, "run:manage") && <CloseRunButton projectId={project.id} runId={run.id} />}
        </div>
      </div>

      {(updatedCount > 0 || assignedCount > 0) && (
        <div role="status" className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="sheet-updated">
          ✓{" "}
          {updatedCount > 0 && <>Updated {updatedCount} {updatedCount === 1 ? "result" : "results"} from the sheet. Old results are in each case&apos;s history. </>}
          {assignedCount > 0 && <>Assigned {assignedCount} {assignedCount === 1 ? "case" : "cases"} to the sheet&apos;s testers.</>}
        </div>
      )}
      {handedTo && handedCases > 0 && <HandOffNote runLabel={runTitle(run, spelling)} cases={handedCases} name={handedTo.name} />}

      {finished && (
        <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="flex-1">
            ✓ All {t.total} {t.total === 1 ? "case has" : "cases have"} a result: {runSummary(counts)}
            {defects.length ? `, ${defects.length} ${defects.length === 1 ? "bug" : "bugs"}` : ""}.{" "}
            {can(who, "run:manage") ? "Close the run to lock results and count it as completed." : "A lead can close it now."}
          </span>
          {can(who, "run:execute") && (
            <LinkButton size="sm" href={`/p/${project.key}/runs/${run.number}/execute`}>
              Open runner
            </LinkButton>
          )}
        </div>
      )}

      {/* ver_200: one box above the cases. The bug lists open under See bugs; By tester shows done counts, never pass or fail per person. */}
      <RunSummary
        done={`${Math.round(t.progress * 100)}%`}
        passed={pct(t.passRate)}
        passedTip={`${t.tested} of ${t.total} cases tested · Steps: ${steps.PASSED ?? 0} passed · ${(steps.FAILED ?? 0) + (steps.BLOCKED ?? 0)} failed or blocked of ${stepTotal} steps`}
        newBugs={defects.length}
        knownBugs={new Set(knownList.map((k) => k.bug.id)).size}
        bar={<StatusBar counts={counts} height="h-2" />}
        testers={
          <>
            {byTester.map((m, i) => (
              <Fragment key={m.id}>
                {i > 0 && " · "}
                <span title={m.name}>
                  {names.get(m.id) ?? m.name} {totals(m.counts).tested}/{m.total}
                  {i === 0 ? " done" : ""}
                </span>
              </Fragment>
            ))}
            {unassigned.length > 0 && `${byTester.length ? " · " : ""}${unassigned.length} unassigned`}
          </>
        }
        bugs={
          <>
            {defects.length > 0 && (
              <div>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Bugs found in this run</h2>
                <ul className="space-y-1 text-sm">
                  {defects.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      {d.externalUrl ? (
                        <a href={d.externalUrl} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium text-accent-700 hover:underline">
                          {d.externalKey}
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-slate-500">D-{d.number}</span>
                      )}
                      <span className="text-slate-800">{d.title}</span>
                      <Badge tone={d.status === "OPEN" ? "red" : "green"}>{d.externalStatus ?? d.status.toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <KnownBugsPanel list={knownList} spelling={spelling} />
          </>
        }
      />

      {/* Sentry: how this build is doing, for runs tested by hand. */}
      {!run.automated && sentryOn && (
        <div className="mb-5">
          <SentryCard projectId={project.id} runIds={[run.id]} />
        </div>
      )}

      {reg.settings.on && reg.comparedWith && (
        <CompareWith
          label={againstLabel(reg.comparedWith)}
          only={reg.only}
          choices={reg.choices}
          count={reg.flagged.size}
          path={`/p/${project.key}/runs/${run.number}`}
        />
      )}
      {byClient && view === "list" && <div className="mb-3 flex justify-end">{viewSwitch}</div>}
      {byClient && view !== "list" ? (
        <ClientGrid
          projectId={project.id}
          projectKey={project.key}
          runId={run.id}
          runNumber={run.number}
          clients={run.clients}
          canRun={run.state === "ACTIVE" && can(who, "run:execute")}
          renderedAt={renderedAt}
          startLabel={t.tested === 0 ? "Start testing" : "Continue testing"}
          viewSwitch={viewSwitch}
          entries={run.entries.map((e) => clientGridEntry(e, caseKey(e.testCase.project.key, e.testCase.number), defectLinks))}
        />
      ) : (
      <RunEntries
        projectId={project.id}
        projectKey={project.key}
        runId={run.id}
        runNumber={run.number}
        members={members}
        canManage={can(who, "run:assign")}
        canRun={run.state === "ACTIVE" && can(who, "run:execute")}
        canMarkRunBefore={can(who, "case:edit")}
        // Bug bash runs hold the bash's areas: they're changed on the bash, not here.
        canRemove={can(who, "run:manage") && run.kind !== "bash"}
        autoNote={!run.withAutomated}
        meId={user.id}
        sort={sort}
        tagColors={tagColors}
        renderedAt={renderedAt}
        rows={sortCases(run.entries, sort, (e) => e.priority, (e) => e.status).map((e) => ({
          caseKey: caseKey(e.testCase.project.key, e.testCase.number),
          caseNumber: e.testCase.number,
          ...titleWithTags(e.title, e.testCase.tags),
          folderPath: e.folderPath,
          priority: e.priority,
          charter: e.kind === "EXPLORATORY",
          automated: e.kind === "AUTOMATED",
          removable: e.status === "UNTESTED" && !e.draftAt && e.results.length === 0,
          lastTestedAt: e.lastTestedAt?.toISOString() ?? null,
          defects: defectsByEntry.get(e.id)?.size ?? 0,
          known: knownMap.get(e.id)?.length ?? 0,
          added: e.addedNote || undefined,
          news: (() => {
            const n = news.get(e.id);
            if (!n) return undefined;
            if (n.kind === "new") return { kind: "new" as const, why: `Added by ${n.addedBy}, ${shortDate(new Date(n.addedAt), spelling, zone)}` };
            return {
              kind: "updated" as const,
              why: n.what,
              href: `/p/${e.testCase.project.key}/cases/${e.testCase.number}/versions/${n.version}?from=${n.since.version}`,
            };
          })(),
          flaky: flaky.get(e.caseId),
          regression: reg.flagged.has(e.id) ? regressionTip(reg.against.get(e.id)!, spelling, zone) : undefined,
          // Status, step pips and who last changed it, worked out the same way the live check does.
          ...liveRowOf(e, user.id),
        }))}
      />
      )}
    </div>
  );
}

/** "2 passed, 1 failed" from a run's case counts. */
function runSummary(counts: Record<string, number>) {
  const words: [string, string][] = [
    ["PASSED", "passed"],
    ["FAILED", "failed"],
    ["BLOCKED", "blocked"],
    ["SKIPPED", "skipped"],
  ];
  return words.filter(([k]) => counts[k]).map(([k, w]) => `${counts[k]} ${w}`).join(", ");
}
