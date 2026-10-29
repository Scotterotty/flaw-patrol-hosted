import { resultSteps } from "@/lib/result-steps";
import { Fragment } from "react";
import { CrumbName } from "@/components/crumb-name";
import Link from "next/link";
import { PersonLabel } from "@/components/avatar";
import { notFound } from "next/navigation";
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
import { RunEntries } from "@/components/run-entries";
import { flakyCases } from "@/lib/flaky";
import { parseDraft } from "@/lib/run-draft";
import { RunSheetButton, RunSheetStatus, type SheetState } from "@/components/run-sheet";
import { StatusBar, StatusLegend } from "@/components/status";
import { Badge, buttonClass, Card, LinkButton } from "@/components/ui";
import { db } from "@/lib/db";
import { caseKey, relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { SHEETS_ENABLED } from "@/lib/features";
import { projectAccess, mySpelling } from "@/lib/session";
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

export const metadata = { title: "Test run" };

export default async function RunPage({ params, searchParams }: { params: Promise<{ key: string; number: string }>; searchParams: Promise<{ handed?: string; compare?: string }> }) {
  const spelling = await mySpelling();
  const { key, number } = await params;
  const { handed, compare } = await searchParams;
  const { project, user, who } = await projectAccess(key);
  const n = Number(number);
  if (!Number.isInteger(n)) notFound();
  const run = await db.testRun.findUnique({
    where: { projectId_number: { projectId: project.id, number: n } },
    include: {
      suite: { select: { id: true, name: true, project: { select: { key: true } } } },
      entries: {
        orderBy: { position: "asc" },
        include: {
          testCase: { select: { number: true, project: { select: { key: true } } } },
          // The last saved result's steps, so finished cases keep their pips.
          results: { orderBy: { createdAt: "desc" }, take: 1, select: { stepResults: true, testerName: true, testerId: true, createdAt: true } },
        },
      },
    },
  });
  if (!run) notFound();
  if (run.automated) return <AutomatedRun project={project} runId={run.id} who={who} />;
  const [members, defectLinks, stepAgg, releases, stepTotal] = await Promise.all([
    projectMembers(project.id),
    db.defectLink.findMany({
      where: { result: { runId: run.id } },
      include: { defect: true, result: { select: { entryId: true } } },
    }),
    db.$queryRaw<{ status: string; n: bigint }[]>`
      SELECT s->>'status' AS status, count(*) AS n
      FROM "RunEntry" e
      JOIN "TestResult" r ON r.id = (SELECT id FROM "TestResult" WHERE "entryId" = e.id ORDER BY "createdAt" DESC LIMIT 1)
      CROSS JOIN LATERAL jsonb_array_elements(r."stepResults") s
      WHERE e."runId" = ${run.id}
      GROUP BY 1`,
    releaseOptions(project.id),
    db.$queryRaw<{ n: bigint | null }[]>`SELECT sum(jsonb_array_length("steps")) AS n FROM "RunEntry" WHERE "runId" = ${run.id} AND jsonb_typeof("steps") = 'array'`,
  ]);

  const sort = await readCaseSort();
  const runFields = await runFieldsFor(project.id);
  const counts = countStatuses(run.entries.map((e) => e.status));
  const t = totals(counts);
  const defectsByEntry = new Map<string, Set<string>>();
  for (const l of defectLinks) {
    const s = defectsByEntry.get(l.result.entryId) ?? new Set();
    s.add(l.defectId);
    defectsByEntry.set(l.result.entryId, s);
  }
  const defects = [...new Map(defectLinks.map((l) => [l.defectId, l.defect])).values()];
  const steps = Object.fromEntries(stepAgg.map((s) => [s.status, Number(s.n)]));
  const byTester = members
    .map((m) => {
      const mine = run.entries.filter((e) => e.assigneeId === m.id);
      return { ...m, counts: countStatuses(mine.map((e) => e.status)), total: mine.length };
    })
    .filter((m) => m.total > 0);
  const unassigned = run.entries.filter((e) => !e.assigneeId);
  const sheet: SheetState = { hook: run.sheetHook, tab: run.sheetTab, auto: run.sheetAuto, link: run.sheetLink, syncedAgo: run.sheetSyncedAt && relativeTime(run.sheetSyncedAt, spelling), error: run.sheetError };
  const slack = run.automated ? [] : await slackSummaryFor(project.id);
  const flaky = await flakyCases({ caseIds: [...new Set(run.entries.map((e) => e.caseId))] });
  // Regression flag (ver_93): cases that passed last release on this platform and fail now.
  const reg = await runRegressions(run, project, compare);
  const failedish = run.entries.filter((e) => ["FAILED", "BLOCKED", "RETEST"].includes(e.status)).length;
  // "Retest 3 not passed" says what's in it on hover: 1 failed · 1 blocked (ver_91).
  const notPassed = (["FAILED", "BLOCKED", "RETEST"] as const)
    .map((s) => [s, run.entries.filter((e) => e.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${STATUS_LABEL[s].toLowerCase()}`)
    .join(" · ");
  // Every case has a result: the run only needs closing.
  const finished = run.state === "ACTIVE" && t.total > 0 && t.tested === t.total;
  // Just started and handed to someone else (ver_85): a link to send them.
  const handedTo = handed ? members.find((m) => m.id === handed) : undefined;
  const handedCases = handedTo ? run.entries.filter((e) => e.assigneeId === handedTo.id).length : 0;

  return (
    <div className="mx-auto max-w-6xl">
      <LiveRefresh url={`/api/live/runs/${run.id}`} />
      <CrumbName href={`/p/${project.key}/runs/${run.number}`} label={run.name} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="font-mono text-base text-slate-500">R{run.number}</span> {run.name}
            {run.state === "COMPLETED" && <Badge tone="gray">Closed</Badge>}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {[
              run.release && `Release ${run.release}`,
              run.suite && (
                <Link key="suite" href={`/p/${run.suite.project.key}/suites/${run.suite.id}`} className="hover:underline">
                  {run.suite.name}
                  {run.suiteVersion ? ` v${run.suiteVersion}` : ""}
                </Link>
              ),
              run.build && `Build ${run.build}`,
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
          {run.description && <p className="mt-1 text-sm text-slate-600">{run.description}</p>}
          {SHEETS_ENABLED && <RunSheetStatus projectId={project.id} runId={run.id} sheet={sheet} />}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {slack.length > 0 && (
            <SlackBell
              channels={slack.map((c) => ({ name: c.name, what: alertSummary(c.alerts) }))}
              href={can(who, "jira:manage") ? (project.groupId && project.slackMode === "umbrella" ? `/g/${project.groupId}/settings#slack` : `/p/${project.key}/settings#slack`) : null}
            />
          )}
          {(SHEETS_ENABLED || can(who, "run:create") || can(who, "run:manage") || can(who, "run:delete")) && (
            <MoreMenu>
              {SHEETS_ENABLED && (
                <a href={`/p/${project.key}/runs/${run.number}/export`} download className={buttonClass("ghost")}>
                  Export to spreadsheet
                </a>
              )}
              {can(who, "run:create") && (
                <EditRunButton
                  projectId={project.id}
                  runId={run.id}
                  details={{ name: run.name, release: run.release, build: run.build, cspVersion: run.cspVersion, environment: run.environment, description: run.description, fields: parseFieldValues(run.fields) }}
                  releases={releases}
                  fields={runFields}
                />
              )}
              {SHEETS_ENABLED && can(who, "run:create") && <RunSheetButton projectId={project.id} runId={run.id} runName={run.name} sheet={sheet} />}
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
              variant="secondary"
              defaults={{ environment: run.environment, release: run.release }}
              fields={runFields}
            />
            </span>
          )}
          {run.state === "ACTIVE" && can(who, "run:execute") && !finished && (
            <LinkButton variant="primary" href={`/p/${project.key}/runs/${run.number}/execute`}>
              {t.tested === 0 ? "Start testing" : "Continue testing"}
            </LinkButton>
          )}
          {finished && can(who, "run:manage") && <CloseRunButton projectId={project.id} runId={run.id} />}
        </div>
      </div>

      {handedTo && handedCases > 0 && <HandOffNote runLabel={`R${run.number}`} cases={handedCases} name={handedTo.name} />}

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

      <div className="mb-5 grid gap-4 md:grid-cols-[1fr_1fr_1fr]">
        <Card className="p-4 md:col-span-2">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <Stat label="Progress" value={`${Math.round(t.progress * 100)}%`} sub={`${t.tested} of ${t.total} cases`} />
            <Stat label="Pass rate" value={pct(t.passRate)} sub="of cases with a verdict" />
            <Stat
              label="Steps"
              value={`${steps.PASSED ?? 0} passed`}
              sub={`${(steps.FAILED ?? 0) + (steps.BLOCKED ?? 0)} failed or blocked of ${Number(stepTotal[0]?.n ?? 0)} steps`}
            />
            <Stat label="Bugs" value={String(defects.length)} sub="found in this run" />
          </div>
          <StatusBar counts={counts} className="mt-4" height="h-3" />
          <div className="mt-2">
            <StatusLegend counts={counts} />
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">By tester</h2>
          <ul className="space-y-2 text-sm">
            {byTester.map((m) => (
              <li key={m.id}>
                <div className="flex justify-between text-xs">
                  <PersonLabel person={m} size={18} className="text-slate-700" />
                  <span className="text-slate-500 tabular-nums">
                    {totals(m.counts).tested}/{m.total}
                  </span>
                </div>
                <StatusBar counts={m.counts} className="mt-1" />
              </li>
            ))}
            {unassigned.length > 0 && <li className="text-xs text-slate-500">{unassigned.length} unassigned</li>}
          </ul>
        </Card>
      </div>

      {defects.length > 0 && (
        <Card className="mb-5 p-4">
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
        </Card>
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
      <RunEntries
        projectId={project.id}
        projectKey={project.key}
        runId={run.id}
        runNumber={run.number}
        members={members}
        canManage={can(who, "run:assign")}
        canRun={run.state === "ACTIVE" && can(who, "run:execute")}
        meId={user.id}
        sort={sort}
        rows={sortCases(run.entries, sort, (e) => e.priority, (e) => e.status).map((e) => ({
          id: e.id,
          caseKey: caseKey(e.testCase.project.key, e.testCase.number),
          caseNumber: e.testCase.number,
          title: e.title,
          folderPath: e.folderPath,
          priority: e.priority,
          charter: e.kind === "EXPLORATORY",
          status: e.status,
          assigneeId: e.assigneeId,
          lastTestedAt: e.lastTestedAt?.toISOString() ?? null,
          defects: defectsByEntry.get(e.id)?.size ?? 0,
          flaky: flaky.get(e.caseId),
          regression: reg.flagged.has(e.id) ? regressionTip(reg.against.get(e.id)!, spelling) : undefined,
          progress:
            e.status === "IN_PROGRESS"
              ? (parseDraft(e.draft)?.stepResults.map((s) => s.status) ?? null)
              : e.status !== "UNTESTED" && e.results[0]
                ? resultSteps(e.results[0].stepResults)
                : null,
          lastChange:
            e.status === "IN_PROGRESS"
              ? e.draftAt
                ? { name: e.draftByName, at: e.draftAt.toISOString(), mine: e.draftById === user.id }
                : null
              : e.status !== "UNTESTED" && e.results[0]
                ? { name: e.results[0].testerName, at: e.results[0].createdAt.toISOString(), mine: e.results[0].testerId === user.id, saved: true }
                : null,
        }))}
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
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
