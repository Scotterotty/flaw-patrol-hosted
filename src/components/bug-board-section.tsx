import { cookies } from "next/headers";
import { loadBugBoard } from "@/lib/bug-board-server";
import { BugBoard } from "./bug-board";
import { EmptyState } from "./ui";

/** Table or Board on the Bugs page: ?view= wins, else the person's last pick, else Table. */
export async function bugsView(view: string | undefined): Promise<"table" | "board"> {
  const v = view ?? (await cookies()).get("fp-bugs-view")?.value;
  return v === "board" ? "board" : "table";
}

/** The Board view (ver_211): every bug on the Jira board, in its columns. */
export async function BugBoardSection({ where, jiraProjectId, scopeIds, board, me }: { where: { groupId?: string; projectId?: string }; jiraProjectId: string; scopeIds: string[]; board?: string; me: { name: string; email: string } }) {
  const data = await loadBugBoard(jiraProjectId, scopeIds, { board });
  if (!data) return <EmptyState title="Connect Jira to see the board">The board shows every bug on your Jira board, in the same columns.</EmptyState>;
  if ("error" in data && data.error) return <EmptyState title="Couldn’t read the Jira board">{data.error}</EmptyState>;
  if (!("columns" in data) || !data.columns.length) return <EmptyState title="No board columns">Jira sent no columns for this board.</EmptyState>;
  return <BugBoard where={where} data={data} me={me} />;
}
