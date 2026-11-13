import { cookies } from "next/headers";
import { loadBugBoard } from "@/lib/bug-board-server";
import type { BoardData, BoardIssue } from "@/lib/bug-board";
import { keepBug, readPicks, sharedFilters, type SharedFilters } from "@/lib/bugs-view";
import { db } from "@/lib/db";
import { BugBoard, type LocalBug } from "./bug-board";
import { EmptyState } from "./ui";

/** Table or Board on the Bugs page: ?view= wins, else the person's last pick, else Table. */
export async function bugsView(view: string | undefined, saved?: "table" | "board"): Promise<"table" | "board"> {
  const v = view ?? saved ?? (await cookies()).get("fp-bugs-view")?.value;
  return v === "board" ? "board" : "table";
}

/**
 * The Bugs page's picks (ver_232): the view, the Jira board and the shared filters, from the web
 * address first, then what the person saved on their account, so they stay after signing out.
 */
export async function bugsSetup(sp: Record<string, string | undefined>, userId: string, jiraKey: string | null) {
  const row = await db.user.findUnique({ where: { id: userId }, select: { bugsPicks: true } });
  const picks = readPicks(row?.bugsPicks);
  const view = jiraKey ? await bugsView(sp.view, picks.view) : "table";
  const board = sp.board ?? (jiraKey ? picks.boards?.[jiraKey] : undefined);
  return { view, board, filters: sharedFilters(sp, picks), picks };
}

type TableBug = { externalKey: string | null; title: string; foundIn: string; externalPriority: string | null; createdBy: string; status: string; label: string };

/**
 * Table with Jira (ver_232): the same bugs as Board. Flaw Patrol's bugs pass the shared filters
 * using their Jira ticket's labels, assignee and priority; open ones that aren't on the picked
 * board stay out, like on Board. With Found in testing off, the board's other bugs come too.
 */
export async function tableBoard(jiraProjectId: string, scopeIds: string[], board: string | undefined, f: SharedFilters, me: { name: string; email: string }, opts: { search?: boolean } = {}) {
  const res = await loadBugBoard(jiraProjectId, scopeIds, { board }).catch(() => null);
  const data: BoardData | null = res && "columns" in res ? res : null;
  const byKey = new Map((data?.issues ?? []).map((i) => [i.key, i]));
  // Only trust "not on the board" when the whole board loaded.
  const complete = !!data && !data.more;
  const keep = (d: TableBug) => {
    const i = d.externalKey ? byKey.get(d.externalKey) : undefined;
    if (complete && d.externalKey && d.status === "OPEN" && !i) return false;
    return keepBug(
      {
        key: d.externalKey ?? d.label,
        title: d.title,
        assignee: i ? i.assignee : d.externalKey ? "" : d.createdBy,
        assigneeEmail: i?.assigneeEmail ?? "",
        labels: i?.labels ?? [],
        priority: i?.priority ?? d.externalPriority ?? "",
        versions: [...(i?.versions ?? []), ...(d.foundIn ? [d.foundIn] : [])],
        inFp: true,
      },
      f,
      me,
      opts,
    );
  };
  const offBoard = (list: TableBug[]) => (complete ? list.filter((d) => d.externalKey && d.status === "OPEN" && !byKey.has(d.externalKey)).length : 0);
  const jiraOnly = (fpKeys: Set<string>): BoardIssue[] => (f.found || !data ? [] : data.issues.filter((i) => !fpKeys.has(i.key) && keepBug({ ...i, inFp: false }, f, me)));
  const options = {
    versions: [...new Set((data?.issues ?? []).flatMap((i) => [...i.versions, ...(i.foundIn ? [i.foundIn] : [])]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    labels: [...new Set((data?.issues ?? []).flatMap((i) => i.labels))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    priorities: [...new Set((data?.issues ?? []).map((i) => i.priority).filter(Boolean))],
  };
  return { data, keep, offBoard, jiraOnly, options, error: res && "error" in res ? res.error : null };
}

/** The Board view (ver_211): every bug on the Jira board, in its columns. */
export async function BugBoardSection({ where, jiraProjectId, jiraKey, scopeIds, board, me, foundDefault, local }: { where: { groupId?: string; projectId?: string }; jiraProjectId: string; jiraKey: string; scopeIds: string[]; board?: string; me: { name: string; email: string }; foundDefault: boolean; local: LocalBug[] }) {
  const data = await loadBugBoard(jiraProjectId, scopeIds, { board });
  if (!data) return <EmptyState title="Connect Jira to see the board">The board shows every bug on your Jira board, in the same columns.</EmptyState>;
  if ("error" in data && data.error) return <EmptyState title="Couldn’t read the Jira board">{data.error}</EmptyState>;
  if (!("columns" in data) || !data.columns.length) return <EmptyState title="No board columns">Jira sent no columns for this board.</EmptyState>;
  return <BugBoard where={where} data={data} me={me} jiraKey={jiraKey} foundDefault={foundDefault} local={local} />;
}
