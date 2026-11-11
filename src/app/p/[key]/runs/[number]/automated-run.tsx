import { runTag, runTitle } from "@/lib/run-label";
import { CrumbName } from "@/components/crumb-name";
import { RunName } from "@/components/run-name";
import { caseNewsForRun } from "@/lib/case-news-data";
import { AutomatedResults, type AutoFileKind, type AutoRow } from "@/components/automated-results";
import { parseSteps } from "@/lib/automation-files";
import { DeleteRunFiles } from "@/components/automation-storage";
import { MoreMenu } from "@/components/more-menu";
import { RunStateButtons } from "@/components/run-actions";
import { StatusBar, StatusLegend } from "@/components/status";
import { Badge, Card } from "@/components/ui";
import { db } from "@/lib/db";
import { flakyCases } from "@/lib/flaky";
import { caseKey, relativeTime } from "@/lib/format";
import { can, type Who } from "@/lib/permissions";
import { mySpelling } from "@/lib/session";
import { countStatuses } from "@/lib/status";
import { jiraConfigFor } from "@/lib/umbrella";
import { StepChips } from "@/components/github-steps";
import { open } from "@/lib/crypto";
import { GitHubClient } from "@/lib/github";

/** The GitHub run's build steps, or null when the repo is gone or GitHub can't be reached. */
async function pulledSteps(repoId: string | null, runId: string) {
  if (!repoId) return null;
  const repo = await db.gitHubRepo.findUnique({ where: { id: repoId }, select: { fullName: true, tokenEncrypted: true } });
  if (!repo) return null;
  try {
    return await new GitHubClient(repo.fullName, open(repo.tokenEncrypted)).steps(runId, true);
  } catch {
    return null;
  }
}

/**
 * A run uploaded from automation results: opens on the failures, with each
 * one's message, stack trace and output, and File bug. Nothing here needs testing.
 */
export async function AutomatedRun({ project, runId, who }: { project: { id: string; key: string }; runId: string; who: Who }) {
  const spelling = await mySpelling();
  const run = await db.testRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      entries: {
        orderBy: { position: "asc" },
        include: {
          testCase: { select: { id: true, number: true, automationId: true, project: { select: { key: true } } } },
          results: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { defects: { include: { defect: true } }, attachments: { where: { kind: { in: ["screenshot", "video", "trace"] } }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, fileName: true, contentType: true, size: true, attempt: true } } },
          },
        },
      },
    },
  });
  const caseIds = run.entries.map((e) => e.caseId);
  const [flaky, jira, earlier, news] = await Promise.all([
    flakyCases({ caseIds }),
    jiraConfigFor(project.id),
    // Each case's result in the run before this one, for "passed in v2.4.1".
    db.testResult.findMany({
      where: { caseId: { in: caseIds }, run: { projectId: project.id, number: { lt: run.number } } },
      orderBy: { createdAt: "desc" },
      distinct: ["caseId"],
      select: { caseId: true, status: true, run: { select: { number: true, name: true, build: true, createdAt: true } } },
    }),
    // New and Updated tests.
    caseNewsForRun(run, run.entries),
  ]);
  const before = new Map(earlier.map((r) => [r.caseId, r]));
  const counts = countStatuses(run.entries.map((e) => e.status));
  const rows: AutoRow[] = run.entries.map((e) => {
    const r = e.results[0];
    const prev = before.get(e.caseId);
    return {
      entryId: e.id,
      resultId: r?.id ?? null,
      caseKey: caseKey(e.testCase.project.key, e.testCase.number),
      caseHref: `/p/${e.testCase.project.key}/cases/${e.testCase.number}`,
      title: e.title,
      status: e.status,
      automationId: e.testCase.automationId ?? "",
      message: r?.failureMessage ?? "",
      stack: r?.stackTrace ?? "",
      output: r?.output ?? "",
      durationMs: r?.durationMs ?? null,
      flaky: flaky.get(e.caseId) ?? 0,
      news: news.get(e.id)?.kind,
      before: prev ? { status: prev.status, run: prev.run.number, label: runTag(prev.run, spelling) || prev.run.name } : null,
      files: (r?.attachments ?? []).map((a) => ({ ...a, kind: a.kind as AutoFileKind })),
      steps: parseSteps(r?.testSteps),
      bugs: (r?.defects ?? []).map((l) => ({ id: l.defect.id, number: l.defect.number, title: l.defect.title, externalKey: l.defect.externalKey, externalUrl: l.defect.externalUrl, status: l.defect.externalStatus ?? l.defect.status })),
    };
  });
  const steps = run.githubRunId ? await pulledSteps(run.githubRepoId, run.githubRunId) : null;
  // Seconds under a minute, so a 12-second suite doesn't read as "1 min".
  const took = run.durationSec == null ? null : run.durationSec < 60 ? `${run.durationSec}s` : `${Math.round(run.durationSec / 60)} min`;
  const canDelete = can(who, "run:delete");
  const fileCount = rows.reduce((n, r) => n + r.files.length, 0);

  return (
    <div className="max-w-6xl">
      <CrumbName href={`/p/${project.key}/runs/${run.number}`} label={runTitle(run, spelling)} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl tracking-tight">
            <RunName run={run} spelling={spelling} className="font-mono text-base font-normal text-slate-500" />
            <Badge tone="violet">🤖 Automated</Badge>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {[run.release && `Release ${run.release}`, run.build && `Build ${run.build}`, run.environment, run.sourceFile && `from ${run.sourceFile}`, took && `tests took ${took}`, `${run.githubRunNo ? "pulled" : "uploaded"} ${relativeTime(run.createdAt, spelling)} by ${run.createdBy}`].filter(Boolean).join(" · ")}
          </p>
          {run.githubRunNo && (
            <div className="mt-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600" data-testid="github-source">
              Pulled from GitHub run #{run.githubRunNo}
              {run.githubRunUrl && (
                <>
                  {" · "}
                  <a href={run.githubRunUrl} target="_blank" rel="noreferrer" className="text-accent-700 underline hover:no-underline">
                    Open on GitHub ↗
                  </a>
                </>
              )}
              {steps && steps.jobs.some((j) => j.steps.length) && (
                <StepChips
                  steps={steps}
                  className="mt-1.5"
                  note={(name) => (/\btests?\b/i.test(name) && run.entries.length ? `${counts.FAILED ?? 0} of ${run.entries.length} failed` : null)}
                />
              )}
              {steps?.buildBroke && (
                <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
                  {steps.jobs.flatMap((j) => j.steps).filter((s) => s.state === "fail" && !/\btests?\b/i.test(s.name)).map((s) => s.name).join(" and ")} also failed, after the tests ran.
                  {steps.message && (
                    <>
                      {" "}GitHub said: <span className="font-mono">{steps.message}</span>
                    </>
                  )}{" "}
                  {steps.logUrl && (
                    <a href={steps.logUrl} target="_blank" rel="noreferrer" className="font-medium text-accent-700 hover:underline">
                      Open the log ↗
                    </a>
                  )}{" "}
                  · All {run.entries.length} test results came through.
                </p>
              )}
            </div>
          )}
        </div>
        {canDelete && (
          <MoreMenu>
            {fileCount > 0 && <DeleteRunFiles runId={run.id} />}
            <RunStateButtons projectId={project.id} projectKey={project.key} runId={run.id} state={run.state} canClose={false} canDelete />
          </MoreMenu>
        )}
      </div>
      <Card className="mb-5 p-4">
        <p className="text-sm text-slate-700">
          <b className="tabular-nums">{counts.PASSED ?? 0}</b> of {run.entries.length} passed · <b className="tabular-nums">{counts.FAILED ?? 0}</b> failed · {counts.SKIPPED ?? 0} skipped
        </p>
        <StatusBar counts={counts} className="mt-3" height="h-3" />
        <div className="mt-2">
          <StatusLegend counts={counts} />
        </div>
      </Card>
      {run.filesDeletedAt && (
        <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200 ring-inset" data-testid="files-deleted">
          Screenshots, videos and replays deleted by {run.filesDeletedBy} {relativeTime(run.filesDeletedAt, spelling)}. Results, errors and steps are kept{fileCount ? ", and files on a bug stay" : ""}.
        </p>
      )}
      <AutomatedResults projectId={project.id} projectKey={project.key} runNumber={run.number} filesDeletedBy={run.filesDeletedAt ? run.filesDeletedBy : null} rows={rows} canFile={can(who, "run:execute")} jiraConnected={!!jira} />
    </div>
  );
}
