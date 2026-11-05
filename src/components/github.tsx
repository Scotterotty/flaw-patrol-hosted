"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { checkGitHubWorkflow, connectGitHub, disconnectGitHub, githubFetchResults, githubPullRuns, listGitHubWorkflows, saveGitHubWorkflow, setGitHubBringFiles, type PullRun } from "@/server/github";
import { Flow, type Pulled } from "./automation-upload";
import { StepChips, StepKey, StepProblem } from "./github-steps";
import { Modal } from "./modal";
import { useCloseRow } from "./settings-row";
import { Button, cx, ErrorText, Field, InfoTip, Input, Select } from "./ui";

// Connect to GitHub and Pull from GitHub: see src/server/github.ts.

export type RepoInfo = { id: string; fullName: string; workflowId: string | null; workflowName: string; glob: string; bringFiles?: boolean };

/** Umbrella Settings → GitHub: each connected repo, and a box to connect another. */
export function GitHubPanel({ groupId, repos }: { groupId: string; repos: RepoInfo[] }) {
  const [adding, setAdding] = useState(repos.length === 0);
  return (
    <div className="space-y-3" data-testid="github-panel">
      {repos.map((r) => (
        <RepoForm key={r.id} groupId={groupId} repo={r} />
      ))}
      {adding ? (
        <RepoForm groupId={groupId} onCancel={repos.length ? () => setAdding(false) : undefined} onSaved={() => setAdding(false)} />
      ) : (
        <Button size="sm" onClick={() => setAdding(true)}>
          ＋ Add another repo
        </Button>
      )}
    </div>
  );
}

type Workflow = { id: string; name: string; path: string };

const SETUP = "Setup not finished: pick which workflow's test results to pull";
type Check = { runs: number; newest: { number: number; files: string[]; tests: number } | null; note: string | null };

function RepoForm({ groupId, repo, onCancel, onSaved }: { groupId: string; repo?: RepoInfo; onCancel?: () => void; onSaved?: () => void }) {
  const router = useRouter();
  const closeRow = useCloseRow();
  const [name, setName] = useState(repo?.fullName ?? "");
  const [token, setToken] = useState("");
  const [repoId, setRepoId] = useState(repo?.id ?? "");
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [workflowId, setWorkflowId] = useState(repo?.workflowId ?? "");
  const [glob, setGlob] = useState(repo?.glob ?? "*.xml");
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [checking, startCheck] = useTransition();
  const [confirmOff, setConfirmOff] = useState(false);

  const runCheck = (id: string, wf: string, g: string) =>
    startCheck(async () => {
      setCheck(null);
      const res = await checkGitHubWorkflow(id, wf, g);
      if (res.ok) setCheck(res);
      else setError(res.error);
    });

  const test = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const res = await connectGitHub(groupId, { repoId: repoId || undefined, repo: name, token });
      if (!res.ok) return setError(res.error);
      setRepoId(res.repoId);
      setName(res.fullName);
      setToken("");
      setWorkflows(res.workflows);
      setWorkflowId(res.workflowId);
      setGlob(res.glob);
      // The picked workflow is saved with the connection.
      setSaved(true);
      runCheck(res.repoId, res.workflowId, res.glob);
      router.refresh();
    });

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveGitHubWorkflow(repoId, { workflowId, workflowName: workflows?.find((w) => w.id === workflowId)?.name ?? repo?.workflowName ?? "", glob });
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
      if (onSaved) onSaved();
      else if (!repo) closeRow?.();
    });

  const disconnect = () =>
    start(async () => {
      const res = await disconnectGitHub(repoId);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  // A saved repo with no workflow (set up before ver_88): show the picker straight away.
  const unfinished = !!repo && !repo.workflowId;
  useEffect(() => {
    if (!repo || !unfinished || workflows) return;
    void listGitHubWorkflows(repo.id).then((res) => {
      if (!res.ok) return setError(res.error);
      setWorkflows(res.workflows);
      setWorkflowId(res.workflowId);
      if (res.workflowId) runCheck(repo.id, res.workflowId, glob);
    });
    // Once, when the row opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unfinished]);

  const tested = !!workflows;
  const prefix = repo?.id ?? "new";
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-surface p-3" data-testid={repo ? `github-repo-${repo.fullName}` : "github-new-repo"}>
      {repo && (!tested || unfinished) && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <b className="text-slate-900">{repo.fullName}</b>
          {repo.workflowId ? (
            <span className="text-slate-500">{`workflow ${repo.workflowName} · results ${repo.glob}`}</span>
          ) : (
            <span className="text-amber-800" data-testid="github-setup-unfinished">
              {SETUP}
            </span>
          )}
        </p>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Repository" htmlFor={`gh-repo-${prefix}`}>
          <Input id={`gh-repo-${prefix}`} data-howto="github-repo" value={name} onChange={(e) => setName(e.target.value)} placeholder="your-org/web-tests" />
        </Field>
        <Field label="Access token" htmlFor={`gh-token-${prefix}`} hint={repo ? "Leave empty to keep the saved token." : undefined}>
          <span className="flex items-center gap-1.5">
            <Input id={`gh-token-${prefix}`} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={repo ? "••••••••" : "github_pat_…"} />
            <InfoTip text="A GitHub fine-grained token that can only read Actions on this one repo (Repository access: only this repo; Permissions: Actions, Read-only). Saved encrypted, like the Jira token." />
          </span>
        </Field>
        {tested && (
          <>
            <Field label="Workflow" htmlFor={`gh-wf-${prefix}`}>
              <Select
                id={`gh-wf-${prefix}`}
                value={workflowId}
                onChange={(e) => {
                  setWorkflowId(e.target.value);
                  runCheck(repoId, e.target.value, glob);
                }}
              >
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Results files" htmlFor={`gh-glob-${prefix}`}>
              <span className="flex items-center gap-1.5">
                <Input id={`gh-glob-${prefix}`} value={glob} onChange={(e) => setGlob(e.target.value)} onBlur={() => runCheck(repoId, workflowId, glob)} />
                <InfoTip text="Which files inside the run's artifact hold the results. Most set-ups leave this as is. Separate several with commas." />
              </span>
            </Field>
            {repoId && <BringFiles repoId={repoId} on={repo?.bringFiles ?? true} />}
          </>
        )}
      </div>
      {tested && (
        <p className={cx("text-sm", check?.newest ? "text-emerald-800" : "text-slate-600")} role="status" data-testid="github-check">
          {checking || !check
            ? "Checking the newest run…"
            : check.newest
              ? `✓ Connected to ${name}. Found ${check.runs} ${check.runs === 1 ? "run" : "runs"} of ${workflows.find((w) => w.id === workflowId)?.name ?? "this workflow"}. The newest has a results file (${check.newest.files.join(", ")}, ${check.newest.tests} ${check.newest.tests === 1 ? "test" : "tests"}).`
              : `✓ Connected to ${name}. ${check.note}`}
        </p>
      )}
      {saved && (
        <p className="text-sm text-emerald-800" role="status">
          ✓ Saved. Use Pull from GitHub to bring in a run.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {tested ? (
          <Button variant="primary" disabled={pending || !workflowId} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        ) : (
          <Button variant="primary" disabled={pending || !name.trim()} onClick={test} data-howto="github-test">
            {pending ? "Testing…" : repo ? "Change and test" : "Save and test"}
          </Button>
        )}
        {repoId &&
          (confirmOff ? (
            <span className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              Disconnect {name}? Runs already pulled stay.
              <Button size="sm" variant="danger" disabled={pending} onClick={disconnect}>
                Disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOff(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button onClick={() => setConfirmOff(true)}>Disconnect</Button>
          ))}
        {!repo && onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}

/** Settings → GitHub: screenshots, videos and replays come from the same artifact. Saves on tick. */
function BringFiles({ repoId, on }: { repoId: string; on: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(on);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-start gap-2 text-sm text-slate-800 sm:col-span-2">
      <input
        type="checkbox"
        className="mt-1"
        checked={v}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setV(next);
          start(async () => {
            const r = await setGitHubBringFiles(repoId, next);
            if (!r.ok) setV(!next);
            router.refresh();
          });
        }}
      />
      <span>
        Also bring in screenshots, videos and replays
        <span className="block text-xs text-slate-500">Read from the same artifact. Turn off to keep uploads small.</span>
      </span>
    </label>
  );
}

/**
 * Pull from GitHub: pick a workflow run, then the test cycle, then the same
 * check-and-save as Upload automation results. Leads and admins.
 */
export function PullFromGitHubButton({
  groupId,
  repos,
  runId,
  label = "⬇ Pull from GitHub",
  variant = "primary",
  size,
  disabled,
  asLink,
}: {
  groupId: string;
  repos: { id: string; fullName: string; workflowName: string }[];
  /** Open with this GitHub run already picked. */
  runId?: string;
  repoId?: string;
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  disabled?: boolean;
  asLink?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {asLink ? (
        <button type="button" className="font-medium text-accent-700 hover:underline" onClick={() => setOpen(true)}>
          {label}
        </button>
      ) : (
        <Button variant={variant} size={size} disabled={disabled || !repos.length} title={repos.length ? undefined : "Connect a repo first"} onClick={() => setOpen(true)} data-howto="repos-pull">
          {label}
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Pull from GitHub" wide>
        {open && <Pull groupId={groupId} repos={repos} runId={runId} onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function Pull({ groupId, repos, runId, onClose }: { groupId: string; repos: { id: string; fullName: string; workflowName: string }[]; runId?: string; onClose: () => void }) {
  const [repoId, setRepoId] = useState(repos[0]?.id ?? "");
  const [list, setList] = useState<{ fullName: string; workflow: string; runs: PullRun[] } | null>(null);
  const [pick, setPick] = useState(runId ?? "");
  const [pulled, setPulled] = useState<Pulled | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    setList(null);
    setError(null);
    githubPullRuns(repoId).then((res) => {
      if (!live) return;
      if (!res.ok) return setError(res.error);
      setList(res);
      // The newest run that still has results, unless one was picked already.
      setPick((p) => (p && res.runs.some((r) => r.id === p) ? p : (res.runs.find((r) => !r.gone && r.status === "completed")?.id ?? "")));
    });
    return () => {
      live = false;
    };
  }, [repoId]);

  const next = () =>
    start(async () => {
      setError(null);
      const res = await githubFetchResults(repoId, pick);
      if (!res.ok) return setError(res.error);
      const r = list?.runs.find((x) => x.id === pick);
      setPulled({ files: res.files, tests: res.tests, build: res.build, groupId: res.groupId, repoId, run: res.run, already: r?.pulled ?? null, stageId: res.stageId, media: res.media });
    });

  if (pulled) return <Flow scope={{ groupId }} pulled={pulled} onClose={onClose} onBack={() => setPulled(null)} />;

  return (
    <div className="space-y-4">
      <ol className="flex gap-3 text-xs text-slate-500" aria-label="Steps">
        {["Pick a GitHub run", "Where they go", "Check and save"].map((s, i) => (
          <li key={s} className={cx(i === 0 && "font-semibold text-accent-700")} aria-current={i === 0 ? "step" : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {repos.length > 1 ? (
        <Field label="Repository" htmlFor="pull-repo">
          <Select id="pull-repo" value={repoId} onChange={(e) => setRepoId(e.target.value)} className="max-w-sm">
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName}
                {r.workflowName ? ` · ${r.workflowName}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <span>
            {repos[0]?.fullName}
            {repos[0]?.workflowName && ` · workflow ${repos[0].workflowName}`}
          </span>
          {list?.runs.some((r) => r.steps) && <StepKey />}
        </p>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {!list && !error && <p className="py-4 text-center text-sm text-slate-500">Asking GitHub for the newest runs…</p>}
      {list &&
        (list.runs.length ? (
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200" role="radiogroup" aria-label="GitHub run" data-howto="pull-pick">
            {list.runs.map((r) => {
              const off = r.gone || r.status !== "completed";
              return (
                <li key={r.id} className={cx(pick === r.id && "bg-accent-50")}>
                  <label className={cx("flex items-start gap-2.5 px-3 py-2 text-sm", off ? "opacity-60" : "cursor-pointer hover:bg-slate-50")}>
                    <input type="radio" name="pull-run" className="mt-1" checked={pick === r.id} disabled={off} onChange={() => setPick(r.id)} aria-label={`GitHub run ${r.number}`} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-900">GitHub run {r.number}</span> · {r.title}
                      <span className="block text-xs text-slate-500">
                        {[r.branch, relativeTime(new Date(r.createdAt))].filter(Boolean).join(" · ")}
                      </span>
                      {r.steps && r.steps.jobs.some((j) => j.steps.length) && <StepChips steps={r.steps} className="mt-1" />}
                      {r.steps && <StepProblem steps={r.steps} className="mt-0.5" />}
                    </span>
                    <span className="flex flex-wrap justify-end gap-1">
                      <RunBadge run={r} />
                      {r.pulled && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700" title="This run's results are already in Flaw Patrol">
                          Already pulled
                        </span>
                      )}
                      {r.gone &&
                        (r.steps?.noTests ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700" title="The build broke before the tests, so there are no results to pull">
                            No tests ran
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800" title="GitHub deletes results files after the repo's retention period">
                            No results file left
                          </span>
                        ))}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">This workflow hasn&apos;t run yet. Run it on GitHub, then pull.</p>
        ))}
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!pick || pending || !list} onClick={next} data-howto="pull-next">
          {pending ? "Downloading results…" : "Next: where they go"}
        </Button>
      </div>
    </div>
  );
}

/** How GitHub marked a workflow run. */
export function RunBadge({ run }: { run: { status: string; conclusion: string | null } }) {
  if (run.status !== "completed") return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Still running</span>;
  if (run.conclusion === "success") return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">✓ Passed in GitHub</span>;
  if (run.conclusion === "failure")
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700" title="GitHub marks the run red when any test fails">
        ✕ Failed in GitHub
      </span>
    );
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{run.conclusion ?? run.status}</span>;
}

/** Links on the Repositories page's failing tests. */
export function FailLinks({ caseHref, runHref }: { caseHref: string; runHref: string }) {
  return (
    <span className="flex gap-3 text-xs">
      <Link href={caseHref} className="font-medium text-accent-700 hover:underline">
        Open case
      </Link>
      <Link href={runHref} className="font-medium text-accent-700 hover:underline">
        File a bug
      </Link>
    </span>
  );
}
