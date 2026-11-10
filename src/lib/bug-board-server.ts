import "server-only";
import { db } from "./db";
import { caseKey } from "./format";
import { JiraError, jiraFor, type JiraClient } from "./jira";
import { runTitle } from "./run-label";
import { loadUmbrella } from "./umbrella";
import { isQaColumn, pickBoard, ticketExtras, withoutOrder, type BoardColumn, type BoardData, type BoardIssue, type FoundAt, type TicketDetail } from "./bug-board";

/**
 * Bug board (ver_211): reads the Jira board's columns and every bug on it. Read only.
 * Jira's own board decides the columns and which issues are on it (its saved filter), so
 * the board here always matches the one the team uses in Jira.
 */

/** The most bugs one board loads. Scott's OB board has ~600 open. */
const MAX_ISSUES = 1000;
const TTL = 2 * 60_000;
const cache = new Map<string, { data: Omit<BoardData, "issues"> & { issues: Omit<BoardIssue, "found">[] }; at: number }>();

type RawBoard = { id: number | string; name?: string; type?: string };
type RawStatus = { id: string; name: string; statusCategory?: { key?: string } };
type RawPerson = { displayName?: string; emailAddress?: string } | null | undefined;
type RawBoardIssue = {
  key: string;
  fields: {
    summary?: string;
    status?: { id?: string; name?: string };
    priority?: { name?: string } | null;
    assignee?: RawPerson;
    labels?: string[];
    fixVersions?: { name?: string }[];
    versions?: { name?: string }[];
  };
};

const q = (v: string) => v.replace(/["\\]/g, " ");
const names = (list: { name?: string }[] | undefined) => (list ?? []).map((v) => v?.name ?? "").filter(Boolean);
const FIELDS = ["summary", "status", "priority", "assignee", "labels", "fixVersions", "versions"];

async function readBoard(client: JiraClient, wanted: string | null) {
  const key = client.creds.jiraProjectKey;
  const found = await client.read<{ values?: RawBoard[] }>(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(key)}&maxResults=50`).catch(() => ({ values: [] as RawBoard[] }));
  const boards = (found.values ?? []).map((b) => ({ id: String(b.id), name: b.name ?? `Board ${b.id}`, type: b.type }));
  const board = pickBoard(boards, wanted);
  const statuses = new Map((await client.read<RawStatus[]>("/rest/api/3/status").catch(() => [] as RawStatus[])).map((s) => [String(s.id), s]));
  const site = client.creds.siteUrl.replace(/\/+$/, "");
  if (board) {
    const cfg = await client.read<{ filter?: { id?: string | number }; columnConfig?: { columns?: { name: string; statuses?: { id: string | number }[] }[] } }>(
      `/rest/agile/1.0/board/${encodeURIComponent(board.id)}/configuration`,
    );
    // Columns with only Done statuses stay off, like the done lane people scroll past in Jira.
    const columns: BoardColumn[] = (cfg.columnConfig?.columns ?? [])
      .map((c) => {
        const ids = (c.statuses ?? []).map((s) => String(s.id));
        return { name: c.name, statusIds: ids, statusNames: ids.map((id) => statuses.get(id)?.name ?? "").filter(Boolean), qa: false };
      })
      .filter((c) => c.statusIds.length && !c.statusIds.every((id) => statuses.get(id)?.statusCategory?.key === "done"));
    const filterJql = cfg.filter?.id ? await client.read<{ jql?: string }>(`/rest/api/3/filter/${encodeURIComponent(String(cfg.filter.id))}`).then((f) => f.jql ?? "", () => "") : "";
    const base = withoutOrder(filterJql) || `project = "${q(key)}"`;
    const order = /\border\s+by\b.*/i.exec(filterJql)?.[0] ?? "ORDER BY Rank ASC";
    const ids = columns.flatMap((c) => c.statusIds);
    const jql = ids.length ? `(${base}) AND status in (${ids.join(",")}) ${order}` : "";
    return { boards: boards.map(({ id, name }) => ({ id, name })), board: { id: board.id, name: board.name }, columns, jql, site };
  }
  // No Jira board (or no Jira Software): one column per open status of the bug type, in Jira's order.
  const byType = await client.read<{ name: string; statuses: RawStatus[] }[]>(`/rest/api/3/project/${encodeURIComponent(key)}/statuses`).catch(() => []);
  const type = byType.find((t) => t.name.toLowerCase() === client.creds.issueType.toLowerCase()) ?? byType[0];
  const open = (type?.statuses ?? []).filter((s) => s.statusCategory?.key !== "done");
  const rank = (s: RawStatus) => (s.statusCategory?.key === "new" ? 0 : 1);
  const columns = open.sort((a, b) => rank(a) - rank(b)).map((s) => ({ name: s.name, statusIds: [String(s.id)], statusNames: [s.name], qa: false }));
  const jql = `project = "${q(key)}" AND issuetype = "${q(client.creds.issueType)}" AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
  return { boards: [], board: null, columns, jql, site };
}

/** The board for a place's Jira, with which bugs a run found. Null when Jira isn't connected. */
export async function loadBugBoard(jiraProjectId: string, scopeIds: string[], opts: { board?: string | null; fresh?: boolean } = {}): Promise<(BoardData & { error?: undefined }) | { error: string } | null> {
  const client = await jiraFor(jiraProjectId).catch((e) => (e instanceof JiraError ? e : null));
  if (!client) return null;
  if (client instanceof JiraError) return { error: client.message };
  const cacheKey = `${jiraProjectId}|${opts.board ?? ""}`;
  let hit = cache.get(cacheKey);
  if (!hit || opts.fresh || Date.now() - hit.at > TTL) {
    try {
      const { boards, board, columns, jql, site } = await readBoard(client, opts.board ?? null);
      const { issues: raw, more } = jql ? await client.searchFields<RawBoardIssue>(jql, FIELDS, MAX_ISSUES) : { issues: [], more: false };
      const known = new Set(columns.flatMap((c) => c.statusIds));
      const issues = raw
        .map((i) => ({
          key: i.key,
          title: i.fields.summary ?? "",
          statusId: String(i.fields.status?.id ?? ""),
          status: i.fields.status?.name ?? "",
          priority: i.fields.priority?.name ?? "",
          assignee: i.fields.assignee?.displayName ?? "",
          assigneeEmail: i.fields.assignee?.emailAddress ?? "",
          labels: i.fields.labels ?? [],
          versions: [...new Set([...names(i.fields.fixVersions), ...names(i.fields.versions)])],
          url: `${site}/browse/${i.key}`,
        }))
        .filter((i) => known.has(i.statusId));
      hit = { data: { boards, board, columns: columns.map((c) => ({ ...c, qa: isQaColumn(c.name) })), issues, more }, at: Date.now() };
      cache.set(cacheKey, hit);
    } catch (e) {
      if (e instanceof JiraError) return { error: e.message };
      throw e;
    }
  }
  const found = await foundKeys(scopeIds);
  return { ...hit.data, issues: hit.data.issues.map((i) => ({ ...i, found: found.has(i.key) })) };
}

/** Jira keys of bugs that a run (or bug bash) found: they're on a test result. */
async function foundKeys(scopeIds: string[]) {
  const rows = await db.defect.findMany({ where: { projectId: { in: scopeIds }, externalKey: { not: null }, links: { some: {} } }, select: { externalKey: true }, distinct: ["externalKey"] });
  return new Set(rows.map((r) => r.externalKey!));
}

/** Forget the cached board, after Refresh from Jira. */
export function forgetBugBoard(jiraProjectId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${jiraProjectId}|`)) cache.delete(k);
}

type RawTicket = {
  key: string;
  names?: Record<string, string>;
  schema?: Record<string, { custom?: string }>;
  fields: {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string } | null;
    assignee?: RawPerson;
    reporter?: RawPerson;
    labels?: string[];
    versions?: { name?: string }[];
    fixVersions?: { name?: string }[];
    components?: { name?: string }[];
    created?: string;
    description?: unknown;
    comment?: { comments?: { id: string; author?: RawPerson; created?: string; body?: unknown }[] };
    attachment?: { id: string; filename?: string; size?: number; mimeType?: string }[];
  };
};

/** One ticket's full view for the bug panel: description, comments, attachments and fields. */
export async function loadTicket(client: JiraClient, key: string): Promise<TicketDetail> {
  // Every field with its name, so the team's own fields (OB's Repro Steps, Build #…) show too (ver_212).
  const t = await client.read<RawTicket>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=*all&expand=names,schema`);
  const f = t.fields;
  const own = ticketExtras(f as unknown as Record<string, unknown>, t.names ?? {}, t.schema ?? {});
  return {
    key: t.key,
    title: f.summary ?? "",
    url: `${client.creds.siteUrl.replace(/\/+$/, "")}/browse/${t.key}`,
    status: f.status?.name ?? "",
    priority: f.priority?.name ?? "",
    assignee: f.assignee?.displayName ?? "",
    reporter: f.reporter?.displayName ?? "",
    labels: f.labels ?? [],
    versions: names(f.versions),
    fixVersions: names(f.fixVersions),
    components: names(f.components),
    created: f.created ?? "",
    description: f.description ?? null,
    repro: own.repro,
    extras: own.extras,
    // Newest first, like reading a chat from the bottom.
    comments: (f.comment?.comments ?? [])
      .map((c) => ({ id: String(c.id), author: c.author?.displayName ?? "Someone", created: c.created ?? "", body: c.body ?? null }))
      .reverse(),
    attachments: (f.attachment ?? []).map((a) => ({ id: String(a.id), name: a.filename ?? "file", size: a.size ?? 0, type: a.mimeType ?? "" })),
  };
}

/** Where testing found the bug: the newest test result it's on, with that case's steps. Null when no run found it. */
export async function foundAt(scopeIds: string[], key: string): Promise<FoundAt | null> {
  const link = await db.defectLink.findFirst({
    where: { defect: { projectId: { in: scopeIds }, externalKey: key } },
    orderBy: { result: { createdAt: "desc" } },
    select: {
      stepIndex: true,
      result: {
        select: {
          createdAt: true,
          testerName: true,
          stepResults: true,
          entryId: true,
          run: { select: { number: true, name: true, build: true, createdAt: true, project: { select: { key: true } } } },
          entry: { select: { title: true, steps: true, testCase: { select: { number: true, project: { select: { key: true } } } } } },
        },
      },
    },
  });
  if (!link) return null;
  const r = link.result;
  const steps = (Array.isArray(r.entry.steps) ? r.entry.steps : []) as { number?: string; action?: string; expected?: string }[];
  const results = (Array.isArray(r.stepResults) ? r.stepResults : []) as { actual?: string }[];
  const step = link.stepIndex !== null && link.stepIndex >= 0 && link.stepIndex < steps.length ? link.stepIndex : null;
  return {
    caseKey: caseKey(r.entry.testCase.project.key, r.entry.testCase.number),
    caseTitle: r.entry.title,
    run: runTitle(r.run),
    by: r.testerName,
    at: r.createdAt.toISOString(),
    href: `/p/${r.run.project.key}/runs/${r.run.number}/execute?entry=${r.entryId}`,
    steps: steps.map((s, i) => ({ number: s.number ?? String(i + 1), action: s.action ?? "", expected: s.expected ?? "" })),
    step,
    actual: step === null ? "" : (results[step]?.actual ?? ""),
  };
}

/**
 * Who may read the board: an umbrella's team (its Jira lives on the hub) or a test cycle's
 * members. Returns where Jira is set up and which test cycles count for "Found in testing".
 */
export async function boardScope(where: { groupId?: string | null; projectId?: string | null }, user: { id: string; isAdmin: boolean }) {
  if (where.groupId) {
    const u = await loadUmbrella(where.groupId, user);
    if (!u) return null;
    return { jiraProjectId: u.hub.id, scopeIds: [u.hub.id, ...u.projects.map((p) => p.id)] };
  }
  if (where.projectId) {
    const member = user.isAdmin || (await db.projectMember.findUnique({ where: { projectId_userId: { projectId: where.projectId, userId: user.id } } }));
    if (!member) return null;
    return { jiraProjectId: where.projectId, scopeIds: [where.projectId] };
  }
  return null;
}

/** A Jira key like OB-5927, and nothing else, before it goes into a Jira address. */
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
