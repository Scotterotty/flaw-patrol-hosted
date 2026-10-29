import "server-only";
import JSZip from "jszip";
import { expandUpload, type Media } from "./automation-media";
import { globMatch } from "./github-glob";
import { buildSteps, pickAnnotation, type BuildSteps, type RawJob } from "./github-steps";

// Pull from GitHub (ver_85): read a repo's workflow runs and download the test
// results their artifacts hold. Flaw Patrol only ever reads from GitHub, with a
// fine-grained token that can read Actions on the repo.

/** GitHub's API, or a stand-in for the e2e tests. */
const API = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

export type GitHubWorkflow = { id: string; name: string; path: string };
export type GitHubRun = { id: string; number: number; title: string; branch: string; createdAt: string; status: string; conclusion: string | null; url: string };
export type GitHubArtifact = { id: string; name: string; size: number; expired: boolean };

export class GitHubError extends Error {}

// A finished run's steps never change, so they're kept (per repo and run) for the life of the server.
const stepCache = new Map<string, BuildSteps>();

/** "owner/name" from what someone typed: the name itself, or a github.com link to it. */
export function repoName(input: string) {
  const s = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const m = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

export class GitHubClient {
  constructor(
    readonly fullName: string,
    private token: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API()}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Flaw-Patrol" },
        cache: "no-store",
      });
    } catch {
      throw new GitHubError("Couldn't reach GitHub. Check this computer's internet connection.");
    }
    if (!res.ok) console.warn(`[github] GET ${path} -> ${res.status} ${res.statusText} (accepted permissions: ${res.headers.get("x-accepted-github-permissions") ?? "n/a"})`);
    if (res.status === 401) throw new GitHubError("GitHub didn't accept the access token. Check it was copied in full and hasn't expired.");
    if (res.status === 404) throw new GitHubError(await this.notFound());
    if (res.status === 403) throw new GitHubError(`The token can't read Actions on ${this.fullName}. Give it "Actions: Read-only" on this repo.`);
    if (!res.ok) throw new GitHubError(`GitHub said ${res.status} ${res.statusText}.`);
    return (await res.json()) as T;
  }

  /** A 404 means "no such repo" or "this token can't see it": say which account the token is, so the fix is clear. */
  private async notFound() {
    const base = `GitHub can't find ${this.fullName} with this token.`;
    try {
      const res = await fetch(`${API()}/user`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Flaw-Patrol" },
        cache: "no-store",
      });
      if (res.status === 401) return "GitHub didn't accept the access token. Check it was copied in full and hasn't expired.";
      if (res.ok) {
        const me = (await res.json()) as { login?: string };
        if (me.login)
          return `${base} The token works and belongs to ${me.login}, but it can't see this repo. On GitHub, edit the token: set Resource owner to ${this.fullName.split("/")[0]}, Repository access to "Only select repositories" with ${this.fullName.split("/")[1]} picked, then Update. Also check the name is spelled right.`;
      }
    } catch {
      // Fall back to the plain message.
    }
    return `${base} Check the name, and that the token was given access to this repo.`;
  }

  async repo() {
    const r = await this.get<{ full_name: string; html_url: string; default_branch: string; private: boolean }>(`/repos/${this.fullName}`);
    return { fullName: r.full_name, url: r.html_url, branch: r.default_branch, private: r.private };
  }

  async workflows(): Promise<GitHubWorkflow[]> {
    const r = await this.get<{ workflows: { id: number; name: string; path: string; state: string }[] }>(`/repos/${this.fullName}/actions/workflows?per_page=100`);
    return r.workflows.filter((w) => w.state === "active").map((w) => ({ id: String(w.id), name: w.name, path: w.path }));
  }

  /** A workflow's newest runs, newest first. */
  async runs(workflowId: string, count = 10): Promise<GitHubRun[]> {
    const r = await this.get<{
      total_count: number;
      workflow_runs: { id: number; run_number: number; display_title?: string; head_branch: string | null; created_at: string; status: string; conclusion: string | null; html_url: string; head_commit?: { message?: string } }[];
    }>(`/repos/${this.fullName}/actions/workflows/${encodeURIComponent(workflowId)}/runs?per_page=${count}`);
    return r.workflow_runs.map((w) => ({
      id: String(w.id),
      number: w.run_number,
      title: (w.display_title || w.head_commit?.message || "").split("\n")[0],
      branch: w.head_branch ?? "",
      createdAt: w.created_at,
      status: w.status,
      conclusion: w.conclusion,
      url: w.html_url,
    }));
  }

  async run(runId: string): Promise<GitHubRun> {
    const w = await this.get<{ id: number; run_number: number; display_title?: string; head_branch: string | null; created_at: string; status: string; conclusion: string | null; html_url: string }>(
      `/repos/${this.fullName}/actions/runs/${encodeURIComponent(runId)}`,
    );
    return { id: String(w.id), number: w.run_number, title: (w.display_title ?? "").split("\n")[0], branch: w.head_branch ?? "", createdAt: w.created_at, status: w.status, conclusion: w.conclusion, url: w.html_url };
  }

  /** Build steps (ver_89): each job's own steps, and GitHub's error line for the one that broke. Same Actions read token. */
  async steps(runId: string, finished: boolean): Promise<BuildSteps> {
    const cacheKey = `${this.fullName}|${runId}`;
    const hit = stepCache.get(cacheKey);
    if (hit) return hit;
    const r = await this.get<{ jobs: (RawJob & { id: number })[] }>(`/repos/${this.fullName}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`);
    const notes = await Promise.all(
      r.jobs.map((j) =>
        j.conclusion === "failure"
          ? this.get<{ message?: string; annotation_level?: string }[]>(`/repos/${this.fullName}/check-runs/${j.id}/annotations`).then(pickAnnotation, () => null)
          : Promise.resolve(null),
      ),
    );
    const out = buildSteps(r.jobs, (i) => notes[i]);
    if (finished) stepCache.set(cacheKey, out);
    return out;
  }

  async artifacts(runId: string): Promise<GitHubArtifact[]> {
    const r = await this.get<{ artifacts: { id: number; name: string; size_in_bytes: number; expired: boolean }[] }>(`/repos/${this.fullName}/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100`);
    return r.artifacts.map((a) => ({ id: String(a.id), name: a.name, size: a.size_in_bytes, expired: a.expired }));
  }

  /** The results files in a run's artifacts: every file whose name matches the glob, as text. */
  async results(runId: string, glob: string) {
    return (await this.resultsWithMedia(runId, glob, false)).files;
  }

  /** The results files, plus the artifacts' screenshots, videos and replays when asked (ver_93). */
  async resultsWithMedia(runId: string, glob: string, withMedia: boolean) {
    const list = (await this.artifacts(runId)).filter((a) => !a.expired);
    if (!list.length) throw new GitHubError("This run has no results file left. GitHub deletes artifacts after the repo's retention period.");
    if (list.reduce((n, a) => n + a.size, 0) > 200 * 1024 * 1024) throw new GitHubError("This run's artifacts are over 200 MB. Upload the results file by hand instead.");
    const files: { name: string; text: string }[] = [];
    const media: Media[] = [];
    for (const a of list) {
      let res: Response;
      try {
        // GitHub answers with a short-lived download link on its storage host; fetch follows it.
        res = await fetch(`${API()}/repos/${this.fullName}/actions/artifacts/${a.id}/zip`, {
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "User-Agent": "Flaw-Patrol" },
          cache: "no-store",
        });
      } catch {
        throw new GitHubError("Couldn't download the results from GitHub's storage. A firewall may be blocking it.");
      }
      if (res.status === 410) continue;
      if (!res.ok) throw new GitHubError(`Downloading ${a.name} failed: GitHub said ${res.status}.`);
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      for (const f of Object.values(zip.files)) {
        if (f.dir) continue;
        if (globMatch(glob, f.name)) files.push({ name: f.name.split("/").pop()!, text: await f.async("string") });
        else if (withMedia && /\.(png|jpe?g|gif|webp|webm|mp4|zip)$/i.test(f.name)) media.push(...(await expandUpload([{ name: f.name, bytes: await f.async("uint8array") }])).media);
      }
    }
    if (!files.length) throw new GitHubError(`No file in this run's artifacts matches "${glob}". Check Results files in Settings → GitHub.`);
    return { files, media };
  }
}
