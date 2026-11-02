// Settings → Jira → Requirements (renamed from Stories in ver_89). Shared by server code and the settings form.

/**
 * `types`: the Jira issue types that count as requirements (loaded from Jira since ver_89).
 * `rollUp`: an Epic also counts the cases linked to its child issues, one level down.
 */
export type StoriesConfig = { project: string; types: string[]; linkBugs: boolean; rollUp: boolean };
/** Offered when Jira can't be asked for the project's own list. */
export const STORY_TYPES = ["Story", "Task", "Epic", "Bug"];
export const DEFAULT_STORIES: StoriesConfig = { project: "", types: ["Story", "Task"], linkBugs: true, rollUp: false };

export function parseStoriesConfig(v: unknown): StoriesConfig | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Partial<StoriesConfig>;
  return {
    project: typeof r.project === "string" ? r.project : "",
    types: Array.isArray(r.types) ? r.types.filter((t): t is string => typeof t === "string") : DEFAULT_STORIES.types,
    linkBugs: r.linkBugs !== false,
    rollUp: r.rollUp === true,
  };
}

/** Epic is the one type whose children can roll up. */
export const isEpic = (type: string | undefined) => (type ?? "").toLowerCase() === "epic";
