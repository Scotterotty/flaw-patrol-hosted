/**
 * Bug board (ver_211): the Bugs page's Board view. Every bug on the team's Jira board,
 * in the board's own columns, read from Jira. Nothing here changes Jira.
 * Types and plain helpers only, so the page and the browser can both use them.
 */

export type BoardColumn = { name: string; statusIds: string[]; statusNames: string[]; qa: boolean };

export type BoardIssue = {
  key: string;
  title: string;
  statusId: string;
  status: string;
  priority: string;
  assignee: string;
  assigneeEmail: string;
  labels: string[];
  versions: string[];
  url: string;
  /** Flaw Patrol has this bug on a test result: a run found it. */
  found: boolean;
};

export type BoardData = {
  boards: { id: string; name: string }[];
  board: { id: string; name: string } | null;
  columns: BoardColumn[];
  issues: BoardIssue[];
  /** More bugs than the board loads at once. */
  more: boolean;
};

/** A comment, attachment and field view of one Jira ticket, for the bug panel. */
export type TicketDetail = {
  key: string;
  title: string;
  url: string;
  status: string;
  priority: string;
  assignee: string;
  reporter: string;
  labels: string[];
  versions: string[];
  fixVersions: string[];
  components: string[];
  created: string;
  /** Jira's description as Atlassian Document Format, or null. */
  description: unknown;
  comments: { id: string; author: string; created: string; body: unknown }[];
  attachments: { id: string; name: string; size: number; type: string }[];
};

/** Where testing found the bug: the case, the run and the step, from Flaw Patrol's own records. */
export type FoundAt = {
  caseKey: string;
  caseTitle: string;
  run: string;
  by: string;
  at: string;
  href: string;
  steps: { number: string; action: string; expected: string }[];
  /** Index into steps, or null when the bug was raised on the whole case. */
  step: number | null;
  actual: string;
};

/** Columns QA works from (Needs QA, In test, Ready for QA, Verify…), outlined on the board. */
export function isQaColumn(name: string) {
  return /\b(qa|q\.a\.|test|testing|verify|verification|validate|validation)\b/i.test(name);
}

/**
 * The board to show when the Jira project has several: the one picked, else one named for
 * bugs, else the first Kanban board, else the first.
 */
export function pickBoard<T extends { id: string; name: string; type?: string }>(boards: T[], wanted?: string | null): T | null {
  return (
    boards.find((b) => b.id === wanted) ??
    boards.find((b) => /\bbugs?\b/i.test(b.name)) ??
    boards.find((b) => b.type === "kanban") ??
    boards[0] ??
    null
  );
}

/** Jira's ORDER BY taken off a filter's JQL, so more conditions can go after it. */
export function withoutOrder(jql: string) {
  const at = jql.search(/\border\s+by\b/i);
  return (at < 0 ? jql : jql.slice(0, at)).trim();
}

export type PriorityTone = "high" | "medium" | "low" | "none";

/** Color for a Jira priority pill. The pill always says the name, so color is never the only cue. */
export function priorityTone(name: string): PriorityTone {
  const n = name.trim().toLowerCase();
  if (!n || /not prioriti/.test(n)) return "none";
  if (/blocker|highest|critical|urgent|high|p0|p1/.test(n)) return "high";
  if (/medium|normal|p2/.test(n)) return "medium";
  return "low";
}

/**
 * Names for the people on the board: first names, with a last initial only when two
 * people share a first name, and "You" for the viewer.
 */
export function shortNames(people: { name: string; email: string }[], me: { name: string; email: string }) {
  const firstOf = (n: string) => n.trim().split(/\s+/)[0] ?? "";
  const byFirst = new Map<string, Set<string>>();
  for (const p of people) {
    if (!p.name) continue;
    const f = firstOf(p.name).toLowerCase();
    byFirst.set(f, (byFirst.get(f) ?? new Set()).add(p.name.trim()));
  }
  return (p: { name: string; email: string }) => {
    if (!p.name) return "Unassigned";
    if (isMe(p, me)) return "You";
    const parts = p.name.trim().split(/\s+/);
    const first = parts[0];
    if ((byFirst.get(first.toLowerCase())?.size ?? 0) > 1 && parts.length > 1) return `${first} ${parts.at(-1)![0]}.`;
    return first;
  };
}

/** The assignee is the viewer: same email, or (when Jira hides emails) the same full name. */
export function isMe(p: { name: string; email: string }, me: { name: string; email: string }) {
  if (p.email && me.email) return p.email.trim().toLowerCase() === me.email.trim().toLowerCase();
  return !!p.name && !!me.name && p.name.trim().toLowerCase() === me.name.trim().toLowerCase();
}

/** "1.2 MB" for an attachment. */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Plain text of an Atlassian Document Format node, for search and fallbacks. */
export function adfText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention" || n.type === "emoji" || n.type === "status") return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
  if (n.type === "inlineCard") return String(n.attrs?.url ?? "");
  const inner = (n.content ?? []).map(adfText).join(n.type === "doc" || n.type === "bulletList" || n.type === "orderedList" ? "\n" : "");
  return inner;
}
