import { githubRunName } from "@/lib/github-name";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FailLinks, PullFromGitHubButton, RunBadge } from "@/components/github";
import { StepChips, StepKey } from "@/components/github-steps";
import { Card, InfoTip, PageHeader } from "@/components/ui";
import { mergeFiles } from "@/lib/automation";
import { open } from "@/lib/crypto";
import { db } from "@/lib/db";
import { relativeTime } from "@/lib/format";
import { GitHubClient, type GitHubRun } from "@/lib/github";
import { can } from "@/lib/permissions";
import { repoHealth } from "@/lib/repo-health";
import { mySpelling, requireUser } from "@/lib/session";
import { loadUmbrella, OPEN_BUG } from "@/lib/umbrella";

export const metadata = { title: "Repositories" };

// Test counts of GitHub runs not pulled yet, read from their results file once.
const summaries = new Map<string, { tests: number; failed: number } | null>();

async function summaryOf(client: GitHubClient, run: GitHubRun, glob: string) {
  const key = `${client.fullName}:${run.id}`;
  if (!summaries.has(key)) {
    try {
      const { tests } = mergeFiles(await client.results(run.id, glob));
      summaries.set(key, { tests: tests.length, failed: tests.filter((t) => t.status === "FAILED").length });
    } catch {
      summaries.set(key, null);
    }
  }
  return summaries.get(key) ?? null;
}

/**
 * Repositories (ver_85): the test health of each connected GitHub repo, from its
 * workflow runs and the results pulled into Flaw Patrol. Code stats stay in GitHub.
 */
export default async function ReposPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const spelling = await mySpelling();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  const g = `/g/${u.group.id}`;
  const repos = await db.gitHubRepo.findMany({ where: { groupId: u.group.id }, orderBy: { createdAt: "asc" } });
  const canPull = can(u.who, "run:import") && !u.group.archivedAt;
  const cards = await Promise.all(repos.map((r) => repoCard(r)));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Repositories" subtitle={`Test health of each GitHub repo connected to ${u.group.name}, from its workflow runs and the results pulled into Flaw Patrol.`} />
      {repos.length === 0 && (
        <Card className="p-6 text-center text-sm text-slate-600">
          No repos connected yet. Connect one in{" "}
          <Link href={`${g}/settings#github`} className="font-medium text-accent-700 underline hover:no-underline">
            {u.group.name} settings → GitHub
          </Link>
          .
        </Card>
      )}
      <div className="space-y-5">
        {cards.map((c) => (
          <Card key={c.repo.id} className="p-4" data-testid={`repo-${c.repo.fullName}`}>
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="font-semibold text-slate-900">{c.repo.fullName}</h2>
              <span className="min-w-0 flex-1 text-sm text-slate-500">
                {[c.repo.workflowName ? `workflow ${c.repo.workflowName}` : "Setup not finished: pick which workflow's test results to pull", c.repo.lastPulledAt && `last pulled ${relativeTime(c.repo.lastPulledAt, spelling)}`].filter(Boolean).join(" · ")}
              </span>
              {canPull && c.repo.workflowId && <PullFromGitHubButton groupId={u.group.id} repos={[{ id: c.repo.id, fullName: c.repo.fullName, workflowName: c.repo.workflowName }]} />}
              <a href={`https://github.com/${c.repo.fullName}/actions`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-surface px-3.5 text-sm text-slate-800 shadow-sm hover:bg-slate-50">
                Open on GitHub ↗
              </a>
            </div>
            {c.error && <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Couldn&apos;t ask GitHub for its newest runs: {c.error}</p>}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Newest GitHub run" value={c.newest ? `Run ${c.newest.run.number}` : "None yet"}>
                {c.newest && (
                  <>
                    {c.newest.counts ? (
                      c.newest.counts.failed ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
                          ✕ {c.newest.counts.failed} of {c.newest.counts.tests} tests failed
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">✓ all {c.newest.counts.tests} tests passed</span>
                      )
                    ) : (
                      <RunBadge run={c.newest.run} />
                    )}{" "}
                    · {c.newest.pulled ? "pulled into Flaw Patrol" : "not pulled yet"}
                  </>
                )}
              </Tile>
              <Tile label="Pass rate" tip="Share of test results that passed in the last 10 runs pulled into Flaw Patrol (fewer if fewer are pulled). A small trend line shows once 3 runs are in." value={c.health.passRate === null ? "–" : `${c.health.passRate}%`}>
                {c.health.total ? `${c.health.passed} of ${c.health.total} in the last ${c.health.pulled === 1 ? "pulled run" : `${c.health.pulled} pulled runs`}` : "Nothing pulled yet"}
                {c.health.trend.length >= 3 && <Spark points={c.health.trend} />}
              </Tile>
              <Tile label="Failing now" tip="Tests that failed in the newest pulled run." value={String(c.health.failingNow.length)} tone={c.health.failingNow.length ? "bad" : undefined}>
                {c.health.failingNow.length ? (c.health.alwaysFailing ? "failed in every pulled run" : "in the newest pulled run") : c.health.pulled ? "none in the newest pulled run" : "Nothing pulled yet"}
              </Tile>
              <Tile label="Flaky" tip="Tests whose result flipped between passed and failed at least twice across the last 10 pulled runs." value={String(c.health.flaky.length)} tone={c.health.flaky.length ? undefined : "ok"}>
                across the pulled runs
              </Tile>
            </div>

            {c.failing.length > 0 && (
              <>
                <h3 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Failing now</h3>
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200" aria-label="Failing now">
                  {c.failing.map((f) => (
                    <li key={f.caseId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <code className="min-w-0 flex-1 truncate text-xs text-slate-800" title={f.name}>
                        {f.name}
                      </code>
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">{f.streak === 1 ? "Failed in the newest run" : `Failed ${f.streak} runs in a row`}</span>
                      {f.bug ? (
                        f.bug.url ? (
                          <a href={f.bug.url} target="_blank" rel="noreferrer" className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-accent-700 hover:underline">
                            {f.bug.label}
                          </a>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{f.bug.label}</span>
                        )
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">No bug filed</span>
                      )}
                      <FailLinks caseHref={f.caseHref} runHref={f.runHref} />
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-5 mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Recent workflow runs</h3>
              {c.runs.some((r) => r.steps) && <StepKey />}
            </div>
            {c.runs.length ? (
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-sm" aria-label="Recent workflow runs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-3 py-2 font-semibold">GitHub run</th>
                      <th className="px-3 py-2 font-semibold">Commit</th>
                      <th className="px-3 py-2 font-semibold">When</th>
                      <th className="px-3 py-2 font-semibold">Tests</th>
                      <th className="px-3 py-2 font-semibold">Steps</th>
                      <th className="px-3 py-2 font-semibold">In Flaw Patrol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {c.runs.map((r) => (
                      <tr key={r.run.id}>
                        <td className="px-3 py-2 tabular-nums">
                          <a href={r.run.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
                            {r.run.number}
                          </a>
                        </td>
                        <td className="max-w-xs px-3 py-2">
                          <span className="block truncate text-slate-800">{r.run.title}</span>
                          <span className="block text-xs text-slate-500">{r.run.branch}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600">{relativeTime(new Date(r.run.createdAt), spelling)}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.counts ? `${r.counts.passed} passed · ${r.counts.failed} failed` : <RunBadge run={r.run} />}</td>
                        <td className="px-3 py-2">
                          {r.steps ? (
                            <>
                              <StepChips steps={r.steps} />
                              {r.steps.buildBroke && r.steps.message && (
                                <span className="mt-0.5 block text-xs text-red-800">
                                  <span className="font-mono">{r.steps.message}</span>{" "}
                                  {r.steps.logUrl && (
                                    <a href={r.steps.logUrl} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
                                      Log ↗
                                    </a>
                                  )}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.pulled ? (
                            <Link href={`/p/${r.pulled.key}/runs/${r.pulled.number}`} className="font-medium text-accent-700 hover:underline">
                              {githubRunName(c.repo.workflowName, r.run.number)}
                            </Link>
                          ) : r.steps?.noTests ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">Build broken · no tests</span>
                          ) : canPull && r.run.status === "completed" ? (
                            <PullFromGitHubButton groupId={u.group.id} repos={[{ id: c.repo.id, fullName: c.repo.fullName, workflowName: c.repo.workflowName }]} runId={r.run.id} label="Pull" asLink />
                          ) : (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{c.repo.workflowId ? "No workflow runs yet." : `Setup not finished: pick which workflow's test results to pull in ${u.group.name} settings → GitHub.`}</p>
            )}
          </Card>
        ))}
      </div>
      {repos.length > 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
          Pull from GitHub brings a run in by hand.
          <InfoTip text="GitHub sending results by itself after every run needs Flaw Patrol hosted, so it comes later." />
        </p>
      )}
    </div>
  );

  async function repoCard(repo: (typeof repos)[number]) {
    const pulled = await db.testRun.findMany({
      where: { githubRepoId: repo.id },
      orderBy: [{ createdAt: "desc" }],
      take: 10,
      select: {
        id: true,
        number: true,
        githubRunId: true,
        project: { select: { key: true } },
        entries: { select: { caseId: true, status: true, title: true, testCase: { select: { number: true, automationId: true, project: { select: { key: true } } } } } },
      },
    });
    const health = repoHealth(pulled);
    const newestPulled = pulled[0];
    const bugs = newestPulled
      ? await db.defectLink.findMany({
          where: { result: { runId: newestPulled.id }, defect: OPEN_BUG },
          select: { result: { select: { caseId: true } }, defect: { select: { number: true, externalKey: true, externalUrl: true } } },
        })
      : [];
    const bugOf = new Map(bugs.map((b) => [b.result.caseId, { label: b.defect.externalKey ?? `D-${b.defect.number}`, url: b.defect.externalUrl }]));
    const failing = health.failingNow.map((f) => {
      const e = newestPulled!.entries.find((x) => x.caseId === f.caseId)!;
      return {
        ...f,
        name: e.testCase.automationId || e.title,
        bug: bugOf.get(f.caseId) ?? null,
        caseHref: `/p/${e.testCase.project.key}/cases/${e.testCase.number}`,
        runHref: `/p/${newestPulled!.project.key}/runs/${newestPulled!.number}`,
      };
    });
    const pulledBy = new Map<string, (typeof pulled)[number]>();
    for (const p of [...pulled].reverse()) if (p.githubRunId) pulledBy.set(p.githubRunId, p);
    const countsOf = (p: (typeof pulled)[number]) => ({ passed: p.entries.filter((e) => e.status === "PASSED").length, failed: p.entries.filter((e) => e.status === "FAILED").length, tests: p.entries.length });

    let ghRuns: GitHubRun[] = [];
    let error: string | null = null;
    let client: GitHubClient | null = null;
    if (repo.workflowId) {
      try {
        client = new GitHubClient(repo.fullName, open(repo.tokenEncrypted));
        ghRuns = await client.runs(repo.workflowId, 10);
      } catch (e) {
        error = e instanceof Error && !/decrypt|auth/i.test(e.message) ? e.message : "the saved token can't be read here. Paste it again in Settings → GitHub.";
      }
    }
    // Runs pulled before (older than GitHub's newest 10 or unreachable) aren't listed: the table is GitHub's view.
    const steps = client ? await Promise.all(ghRuns.map((r) => client!.steps(r.id, r.status === "completed").catch(() => null))) : [];
    const runs = ghRuns.map((r, i) => {
      const p = pulledBy.get(r.id);
      return { run: r, pulled: p ? { key: p.project.key, number: p.number } : null, counts: p ? countsOf(p) : null, steps: steps[i] ?? null };
    });
    let newest: { run: GitHubRun; pulled: { number: number } | null; counts: { tests: number; failed: number } | null } | null = null;
    if (runs[0]) {
      const first = runs[0];
      const counts = first.counts ?? (client && first.run.status === "completed" ? await summaryOf(client, first.run, repo.resultsGlob) : null);
      newest = { run: first.run, pulled: first.pulled, counts };
    }
    return { repo, health, failing, runs, newest, error };
  }
}

function Tile({ label, tip, value, tone, children }: { label: string; tip?: string; value: string; tone?: "bad" | "ok"; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="flex items-center gap-1 text-xs text-slate-500">
        {label}
        {tip && <InfoTip text={tip} />}
      </p>
      <p className={`text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "ok" ? "text-emerald-700" : "text-slate-900"}`}>{value}</p>
      <div className="mt-0.5 text-xs text-slate-500">{children}</div>
    </div>
  );
}

/** Pass rate per pulled run, oldest to newest. */
function Spark({ points }: { points: number[] }) {
  const w = 120;
  const h = 22;
  const lo = Math.min(...points, 80);
  const span = Math.max(100 - lo, 1);
  const y = (v: number) => (h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1);
  const x = (i: number) => ((i * (w - 4)) / Math.max(points.length - 1, 1) + 2).toFixed(1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 block h-5.5 w-30 text-accent-600" role="img" aria-label={`Pass rate for the last ${points.length} pulled runs, from ${points[0]}% to ${points[points.length - 1]}%`}>
      <path d={points.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="2.4" fill="currentColor" />
    </svg>
  );
}
