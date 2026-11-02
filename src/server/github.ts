"use server";

import { logActivity } from "@/lib/activity";
import type { BuildSteps } from "@/lib/github-steps";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { mergeFiles } from "@/lib/automation";
import { countMedia, matchMedia } from "@/lib/automation-media";
import { stageMedia } from "@/lib/media-stage";
import { open, seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { GitHubClient, GitHubError, repoName } from "@/lib/github";
import type { Action } from "@/lib/permissions";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

// Connect to GitHub and Pull from GitHub. Admins connect a repo on the
// umbrella's Settings (like Jira); leads and admins pull a workflow run's results,
// which then go through the same check-and-save steps as Upload automation results.

async function requireGroup(groupId: string, action: Action) {
  const group = await db.projectGroup.findUnique({ where: { id: groupId }, include: { hub: true } });
  if (!group?.hub) throw new UserError("This isn't an umbrella.");
  const { user } = await requireProjectAction(group.hub.id, action);
  return { user, group, hub: group.hub };
}

async function requireRepo(repoId: string, action: Action) {
  const repo = await db.gitHubRepo.findUnique({ where: { id: repoId } });
  if (!repo) throw new UserError("That repo isn't connected any more.");
  const { user, group, hub } = await requireGroup(repo.groupId, action);
  return { user, group, hub, repo };
}

/** Talk to GitHub as the saved token, turning its errors into plain messages. */
function clientOf(repo: { fullName: string; tokenEncrypted: string }) {
  let token: string;
  try {
    token = open(repo.tokenEncrypted);
  } catch {
    throw new UserError("The saved GitHub token can't be read here (it was saved with a different AUTH_SECRET). Paste the token again in Settings → GitHub.");
  }
  return new GitHubClient(repo.fullName, token);
}

async function gh<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GitHubError) throw new UserError(e.message);
    throw e;
  }
}

function refresh(groupId: string, hubKey: string) {
  revalidatePath(`/g/${groupId}`, "layout");
  revalidatePath(`/p/${hubKey}`, "layout");
}

const connectSchema = z.object({
  repoId: z.string().optional(),
  repo: z.string().trim().min(1, "Type the repo, like your-org/web-tests."),
  token: z.string().trim().max(500).default(""),
});

/** Save and test: check the repo and token can read Actions, then list its workflows. */
export async function connectGitHub(groupId: string, input: z.input<typeof connectSchema>) {
  return attempt(async () => {
    const { group, hub, user } = await requireGroup(groupId, "jira:manage");
    const data = connectSchema.parse(input);
    const fullName = repoName(data.repo);
    if (!fullName) throw new UserError("Type the repo as owner/name, like your-org/web-tests, or paste its GitHub link.");
    const old = data.repoId ? await db.gitHubRepo.findFirst({ where: { id: data.repoId, groupId } }) : null;
    if (!data.token && !old) throw new UserError("Paste an access token. Make one on GitHub: Settings → Developer settings → Fine-grained tokens.");
    const tokenEncrypted = data.token ? seal(data.token) : old!.tokenEncrypted;
    const client = clientOf({ fullName, tokenEncrypted });
    const info = await gh(() => client.repo());
    const workflows = await gh(() => client.workflows());
    if (!workflows.length) throw new UserError(`${info.fullName} has no GitHub Actions workflows yet.`);
    const clash = await db.gitHubRepo.findFirst({ where: { groupId, fullName: { equals: info.fullName, mode: "insensitive" }, id: { not: old?.id ?? "" } } });
    if (clash) throw new UserError(`${info.fullName} is already connected to ${group.name}.`);
    const repo = old
      ? await db.gitHubRepo.update({ where: { id: old.id }, data: { fullName: info.fullName, tokenEncrypted } })
      : await db.gitHubRepo.create({ data: { groupId, fullName: info.fullName, tokenEncrypted } });
    await logActivity({ actor: user, kind: "settings", action: `${old ? "Changed" : "Connected"} GitHub repo ${info.fullName}`, group, detail: data.token && old ? "Token replaced" : "" });
    refresh(groupId, hub.key);
    // Offer the workflow already picked, else one that sounds like tests.
    const pick = workflows.find((w) => w.id === repo.workflowId) ?? workflows.find((w) => /test/i.test(w.name)) ?? workflows[0];
    // Save and test saves that pick too, so the repo is ready to pull without a second Save.
    if (repo.workflowId !== pick.id) await db.gitHubRepo.update({ where: { id: repo.id }, data: { workflowId: pick.id, workflowName: pick.name } });
    return { repoId: repo.id, fullName: repo.fullName, workflows, workflowId: pick.id, glob: repo.resultsGlob };
  });
}

/** The repo's workflows with the saved token, for a repo whose setup isn't finished (no workflow saved). */
export async function listGitHubWorkflows(repoId: string) {
  return attempt(async () => {
    const { repo } = await requireRepo(repoId, "jira:manage");
    const workflows = await gh(() => clientOf(repo).workflows());
    const pick = workflows.find((w) => w.id === repo.workflowId) ?? workflows.find((w) => /test/i.test(w.name)) ?? workflows[0];
    return { workflows, workflowId: pick?.id ?? "" };
  });
}

/** What a workflow's newest run holds, so the admin sees the setup works before saving. */
export async function checkGitHubWorkflow(repoId: string, workflowId: string, glob: string) {
  return attempt(async () => {
    const { repo } = await requireRepo(repoId, "jira:manage");
    const client = clientOf(repo);
    const runs = await gh(() => client.runs(workflowId, 10));
    if (!runs.length) return { runs: 0, newest: null, note: "This workflow hasn't run yet. Run it once on GitHub, then pull." };
    const newest = runs[0];
    try {
      const files = await client.results(newest.id, glob || "*.xml");
      const { tests } = mergeFiles(files);
      return { runs: runs.length, newest: { number: newest.number, files: files.map((f) => f.name), tests: tests.length }, note: null };
    } catch (e) {
      return { runs: runs.length, newest: null, note: e instanceof Error ? `GitHub run ${newest.number}: ${e.message}` : "The newest run's results couldn't be read." };
    }
  });
}

const workflowSchema = z.object({ workflowId: z.string().min(1, "Pick a workflow."), workflowName: z.string().max(200).default(""), glob: z.string().trim().max(200).default("*.xml") });

export async function saveGitHubWorkflow(repoId: string, input: z.input<typeof workflowSchema>) {
  return attempt(async () => {
    const { repo, hub, user, group } = await requireRepo(repoId, "jira:manage");
    const data = workflowSchema.parse(input);
    await db.gitHubRepo.update({ where: { id: repo.id }, data: { workflowId: data.workflowId, workflowName: data.workflowName, resultsGlob: data.glob || "*.xml" } });
    await logActivity({ actor: user, kind: "settings", action: `Changed GitHub workflow for ${repo.fullName}`, group, detail: data.workflowName });
    refresh(repo.groupId, hub.key);
    return {};
  });
}

/** Disconnect: runs pulled from it stay, with their link to GitHub. */
export async function disconnectGitHub(repoId: string) {
  return attempt(async () => {
    const { repo, hub, user, group } = await requireRepo(repoId, "jira:manage");
    await db.gitHubRepo.delete({ where: { id: repo.id } });
    await logActivity({ actor: user, kind: "settings", action: `Disconnected GitHub repo ${repo.fullName}`, group });
    refresh(repo.groupId, hub.key);
    return {};
  });
}

export type PullRun = {
  id: string;
  number: number;
  title: string;
  branch: string;
  createdAt: string;
  conclusion: string | null;
  status: string;
  url: string;
  pulled: { key: string; number: number } | null;
  /** No results file left: GitHub deleted the artifacts, or the run never made any. */
  gone: boolean;
  /** The workflow's own steps and what broke; null when GitHub couldn't say. */
  steps: BuildSteps | null;
};

/** Step 1 of Pull from GitHub: the workflow's newest runs, and which are already in Flaw Patrol. */
export async function githubPullRuns(repoId: string) {
  return attempt(async () => {
    const { repo } = await requireRepo(repoId, "run:import");
    if (!repo.workflowId) throw new UserError(`Setup not finished: pick which workflow's test results to pull in Settings → GitHub.`);
    const client = clientOf(repo);
    const runs = await gh(() => client.runs(repo.workflowId!, 10));
    const pulled = await pulledRuns(repo.id, runs.map((r) => r.id));
    const [artifacts, steps] = await Promise.all([
      Promise.all(runs.map((r) => (r.status === "completed" ? client.artifacts(r.id).catch(() => null) : Promise.resolve(null)))),
      Promise.all(runs.map((r) => client.steps(r.id, r.status === "completed").catch(() => null))),
    ]);
    return {
      fullName: repo.fullName,
      workflow: repo.workflowName,
      runs: runs.map(
        (r, i): PullRun => ({
          ...r,
          pulled: pulled.get(r.id) ?? null,
          gone: r.status === "completed" && !!artifacts[i] && !artifacts[i]!.some((a) => !a.expired),
          steps: steps[i],
        }),
      ),
    };
  });
}

/** GitHub run id → the Flaw Patrol run it was pulled into (the newest one). */
async function pulledRuns(repoId: string, ids: string[]) {
  const rows = await db.testRun.findMany({
    where: { githubRepoId: repoId, githubRunId: { in: ids } },
    orderBy: { createdAt: "asc" },
    select: { githubRunId: true, number: true, project: { select: { key: true } } },
  });
  return new Map(rows.map((r) => [r.githubRunId!, { key: r.project.key, number: r.number }]));
}

/** Download a run's results file: the files go on to the same steps as Upload automation results. */
export async function githubFetchResults(repoId: string, runId: string) {
  return attempt(async () => {
    const { repo, user } = await requireRepo(repoId, "run:import");
    const client = clientOf(repo);
    const run = await gh(() => client.run(runId));
    const { files, media } = await gh(() => client.resultsWithMedia(runId, repo.resultsGlob, repo.bringFiles));
    let read;
    try {
      read = mergeFiles(files);
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : "The results file couldn't be read.");
    }
    if (!read.tests.length) throw new UserError("That run's results file has no tests in it.");
    // Screenshots, videos and replays wait on the server until Save.
    const stageId = await stageMedia(media, user.id);
    return {
      files,
      stageId,
      media: media.length ? { ...countMedia(media), unmatched: matchMedia(read.tests, media).unmatched } : null,
      tests: read.tests.length,
      // The file's own build wins; otherwise the GitHub run number.
      build: read.build || String(run.number),
      run: { id: run.id, number: run.number, url: run.url },
      workflow: repo.workflowName,
      groupId: repo.groupId,
    };
  });
}

/** Settings → GitHub: also bring in screenshots, videos and replays from the same artifact. */
export async function setGitHubBringFiles(repoId: string, on: boolean) {
  return attempt(async () => {
    const { repo, hub, user, group } = await requireRepo(repoId, "jira:manage");
    await db.gitHubRepo.update({ where: { id: repo.id }, data: { bringFiles: on } });
    await logActivity({ actor: user, kind: "settings", action: `${on ? "Turned on" : "Turned off"} screenshots, videos and replays from ${repo.fullName}`, group });
    refresh(repo.groupId, hub.key);
    return {};
  });
}
