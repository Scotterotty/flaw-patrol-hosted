import "server-only";
import { jiraFor, type JiraIssue } from "./jira";
import { jiraConfigFor } from "./umbrella";

// Jira stories (ver_82): cases store only story keys; titles and Jira statuses are
// read from Jira when a page opens and kept for 10 minutes.

import { DEFAULT_STORIES, parseStoriesConfig } from "./stories-config";

export { DEFAULT_STORIES, isEpic, parseStoriesConfig, STORY_TYPES, type StoriesConfig } from "./stories-config";

/** The test cycle's (or its umbrella's) Stories setup; the default when Jira is connected but stories weren't set up. */
export async function storiesConfigFor(projectId: string) {
  const cfg = await jiraConfigFor(projectId);
  if (!cfg) return null;
  return { config: parseStoriesConfig(cfg.stories) ?? DEFAULT_STORIES, bugProject: cfg.jiraProjectKey, site: cfg.siteUrl };
}

/** `type`: the Jira issue type (Story, Epic, Requirement…). `parent`: its Epic or other parent, when it has one. */
export type StoryInfo = { key: string; title: string; status: string; category: string; url: string | null; type?: string; parent?: string | null; missing?: boolean; stale?: string; priority?: string; points?: number | null };

/** What Jira search results carry into a StoryInfo. */
export const infoOf = (i: JiraIssue): StoryInfo => ({ key: i.key, title: i.summary, status: i.status, category: i.category, url: i.url, type: i.type, parent: i.parent });

/** Keep Jira search results in the cache too, so the next page needn't ask again. */
export function rememberStories(issues: JiraIssue[]) {
  const now = Date.now();
  for (const i of issues) cache.set(i.key.toUpperCase(), { info: infoOf(i), at: now });
}

const cache = new Map<string, { info: StoryInfo; at: number }>();
const TTL = 10 * 60_000;

/** Title and Jira status for each key, from the cache or Jira. Unreachable Jira keeps the last known, with an "as of" time. */
export async function storyInfo(projectId: string, keys: string[]): Promise<Map<string, StoryInfo>> {
  const out = new Map<string, StoryInfo>();
  const wanted = [...new Set(keys.map((k) => k.toUpperCase()))];
  const now = Date.now();
  const stale: string[] = [];
  for (const k of wanted) {
    const hit = cache.get(k);
    if (hit && now - hit.at < TTL) out.set(k, hit.info);
    else stale.push(k);
  }
  if (!stale.length) return out;
  let client = null;
  try {
    client = await jiraFor(projectId);
  } catch {
    client = null;
  }
  let found: JiraIssue[] | null = null;
  if (client) {
    try {
      found = await client.getMany(stale);
    } catch {
      found = null;
    }
  }
  for (const k of stale) {
    const issue = found?.find((i) => i.key.toUpperCase() === k);
    if (issue) {
      const info = infoOf(issue);
      cache.set(k, { info, at: now });
      out.set(k, info);
    } else if (found) {
      const info = { key: k, title: "Not found in Jira", status: "", category: "", url: null, missing: true };
      cache.set(k, { info, at: now });
      out.set(k, info);
    } else {
      const old = cache.get(k);
      out.set(k, old ? { ...old.info, stale: new Date(old.at).toISOString() } : { key: k, title: "", status: "", category: "", url: null });
    }
  }
  return out;
}

/** "PRJ-12, prj-13 PRJ-14" → keys, for imports and pasted lists. */
export function storyKeysIn(text: string) {
  return [...new Set([...text.matchAll(/\b([A-Za-z][A-Za-z0-9]{1,9}-\d+)\b/g)].map((m) => m[1].toUpperCase()))];
}

/** Refresh on the Stories page: read every title and status from Jira again. */
export function forgetStories() {
  cache.clear();
}
