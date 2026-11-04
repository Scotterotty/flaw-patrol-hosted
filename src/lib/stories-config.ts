// Settings → Jira → Requirements (renamed from Stories in ver_89). Shared by server code and the settings form.

/**
 * `project`: "" = the bug project, "*" = any project, else a Jira project key.
 * `projects`: several Jira project keys (ver_161, "These projects"). `project` then holds the first,
 * so an older copy of Flaw Patrol on the same database still reads one of them.
 * `types`: the Jira issue types that count as requirements (loaded from Jira since ver_89).
 * `allTypes`: every issue type counts instead, except Sub-tasks ("Every issue type"). `types` is kept for switching back.
 * `rollUp`: an Epic also counts the cases linked to its child issues, one level down.
 */
export type StoriesConfig = { project: string; projects: string[]; types: string[]; allTypes: boolean; linkBugs: boolean; rollUp: boolean };
/** Offered when Jira can't be asked for the project's own list. */
export const STORY_TYPES = ["Story", "Task", "Epic", "Bug"];
export const DEFAULT_STORIES: StoriesConfig = { project: "", projects: [], types: ["Story", "Task"], allTypes: false, linkBugs: true, rollUp: false };

export function parseStoriesConfig(v: unknown): StoriesConfig | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Partial<StoriesConfig>;
  return {
    project: typeof r.project === "string" ? r.project : "",
    projects: Array.isArray(r.projects) ? [...new Set(r.projects.filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim().toUpperCase()))] : [],
    types: Array.isArray(r.types) ? r.types.filter((t): t is string => typeof t === "string") : DEFAULT_STORIES.types,
    allTypes: r.allTypes === true,
    linkBugs: r.linkBugs !== false,
    rollUp: r.rollUp === true,
  };
}

/** The issue types in words: "every issue type except Sub-tasks" or "Story, Task". */
export function requirementTypes(cfg: Pick<StoriesConfig, "types" | "allTypes">) {
  return cfg.allTypes ? "every issue type except Sub-tasks" : cfg.types.join(", ");
}

/** Epic is the one type whose children can roll up. */
export const isEpic = (type: string | undefined) => (type ?? "").toLowerCase() === "epic";

/** The Jira projects requirements come from, or null for any project. */
export function requirementProjects(cfg: Pick<StoriesConfig, "project" | "projects">, bugProject: string): string[] | null {
  if (cfg.project === "*") return null;
  if (cfg.projects?.length) return cfg.projects;
  return [cfg.project || bugProject].filter(Boolean);
}

/** "OW", "OW and MOB", "OW, MOB and WEB". */
export function listKeys(keys: string[]) {
  return keys.length < 2 ? (keys[0] ?? "") : `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;
}

/** Where requirements come from, in words: "Jira project OW", "Jira projects OW and MOB", "any Jira project". */
export function requirementSource(cfg: Pick<StoriesConfig, "project" | "projects">, bugProject: string) {
  const keys = requirementProjects(cfg, bugProject);
  if (!keys) return "any Jira project";
  return `Jira project${keys.length > 1 ? "s" : ""} ${listKeys(keys)}`.trim();
}

/** Several projects' release lists (each newest first) as one: taking turns, each name once. */
export function mergeReleases(lists: string[][]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++)
    for (const l of lists) {
      const r = l[i];
      if (r && !seen.has(r)) {
        seen.add(r);
        out.push(r);
      }
    }
  return out;
}
