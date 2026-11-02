import "server-only";
import { open } from "./crypto";
import { GitHubClient, GitHubError } from "./github";
import { UserError } from "@/server/result";

/** One workflow run, read from GitHub with the repo's saved token. */
export async function githubRunOf(repo: { fullName: string; tokenEncrypted: string }, runId: string) {
  try {
    return await new GitHubClient(repo.fullName, open(repo.tokenEncrypted)).run(runId);
  } catch (e) {
    if (e instanceof GitHubError) throw new UserError(e.message);
    throw new UserError("The saved GitHub token can't be read here. Paste it again in Settings → GitHub.");
  }
}
