"use server";

import { boardScope, foundAt, ISSUE_KEY, loadTicket } from "@/lib/bug-board-server";
import { jiraFor } from "@/lib/jira";
import { Forbidden, requireUser } from "@/lib/session";
import { attempt, UserError } from "./result";
import { db } from "@/lib/db";
import { mergePicks, readPicks } from "@/lib/bugs-view";
import { JiraError } from "@/lib/jira";

type Where = { groupId?: string | null; projectId?: string | null };

/** The bug panel (ver_211): one Jira ticket in full, and where a run found it. Read only. */
export async function bugTicket(where: Where, key: string) {
  return attempt(async () => {
    const user = await requireUser();
    const scope = await boardScope(where, user);
    if (!scope) throw new Forbidden();
    if (!ISSUE_KEY.test(key)) throw new UserError("That isn't a Jira key.");
    const client = await jiraFor(scope.jiraProjectId).catch((e) => {
      throw e instanceof JiraError ? new UserError(e.message) : e;
    });
    if (!client) throw new UserError("Jira isn't connected.");
    const [ticket, found] = await Promise.all([
      loadTicket(client, key).catch((e) => {
        throw e instanceof JiraError ? new UserError(e.message) : e;
      }),
      foundAt(scope.scopeIds, key),
    ]);
    return { ticket, found };
  });
}

/** Save the Bugs page picks on the person's account (ver_232): the view, Found in testing and the Jira board. */
export async function saveBugsPicks(patch: { view?: string; found?: boolean; board?: { jira: string; id: string } }) {
  return attempt(async () => {
    const user = await requireUser();
    const row = await db.user.findUnique({ where: { id: user.id }, select: { bugsPicks: true } });
    const next = mergePicks(readPicks(row?.bugsPicks), patch);
    await db.user.update({ where: { id: user.id }, data: { bugsPicks: next } });
    return {};
  });
}
