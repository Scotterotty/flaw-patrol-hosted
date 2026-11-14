import "server-only";
import { db } from "./db";
import { auditJql, claimLive, pace, reopenedChecks, type AuditClaim, type AuditIssue } from "./bug-audit";
import type { JiraClient } from "./jira";

// Bug audit (ver_250): reading the audit's Jira filter. Cached for a minute so a team clicking
// Next bug doesn't run a 600-bug search each time; anything that changes a bug clears it.

const TTL = 60_000;
/** The most bugs one audit loads. OB's audit started at 586. */
export const MAX_AUDIT_BUGS = 2000;
/** The most labelled bugs read back to match Checked so far against Jira. */
const MAX_LABELLED = 5000;
const FIELDS = ["summary", "status", "priority", "components", "labels", "created"];

type RawIssue = { key: string; fields: { summary?: string; status?: { name?: string }; priority?: { name?: string } | null; components?: { name?: string }[]; labels?: string[]; created?: string } };

const cache = new Map<string, { at: number; issues: AuditIssue[]; more: boolean; done: number }>();

export const forgetAudit = (auditId: string) => cache.delete(auditId);

/** The bugs still on the filter, in its own order, and how many already carry the label in Jira. */
export async function auditIssues(audit: { id: string; jql: string; label: string }, client: JiraClient) {
  const hit = cache.get(audit.id);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const [found, labelled] = await Promise.all([
    client.searchFields<RawIssue>(auditJql(audit.jql, audit.label), FIELDS, MAX_AUDIT_BUGS),
    // Every bug carrying the label in Jira (ver_254): the checked count, and what Checked so far must match.
    client.searchFields<{ key: string }>(`labels = "${audit.label.replace(/["\\]/g, "")}"`, [], MAX_LABELLED).catch(() => null),
  ]);
  const done = labelled?.issues.length ?? 0;
  const issues = found.issues.map((r) => ({
    key: r.key,
    title: (r.fields.summary ?? "").trim(),
    status: r.fields.status?.name ?? "",
    priority: r.fields.priority?.name ?? "",
    components: (r.fields.components ?? []).map((c) => c.name ?? "").filter(Boolean),
    labels: r.fields.labels ?? [],
    created: r.fields.created ?? "",
  }));
  // Someone removed the label in Jira (open or closed bug alike): it isn't checked any more. Only with
  // a full, successful read of the labelled bugs, so a Jira hiccup never clears anything.
  const checked = await db.bugAuditCheck.findMany({ where: { auditId: audit.id, checkedAt: { not: null } }, select: { issueKey: true, checkedAt: true } });
  const reopened = labelled && !labelled.more ? reopenedChecks(checked, new Set(labelled.issues.map((i) => i.key)), new Date()) : [];
  if (reopened.length) {
    await db.bugAuditCheck.updateMany({
      where: { auditId: audit.id, issueKey: { in: reopened } },
      data: { checkedAt: null, checkedById: null, checkedBy: "", outcome: "", claimedById: null, claimedBy: "", claimedAt: null },
    });
  }
  const entry = { at: Date.now(), issues, more: found.more, done };
  cache.set(audit.id, entry);
  return entry;
}

/** Who holds or has checked each bug in this audit. */
export async function auditClaims(auditId: string) {
  const rows = await db.bugAuditCheck.findMany({ where: { auditId }, select: { issueKey: true, claimedById: true, claimedBy: true, claimedAt: true, checkedAt: true } });
  return new Map<string, AuditClaim>(rows.map((r) => [r.issueKey, r]));
}

/** The numbers across the top of the Audit page. */
export function auditProgress(left: number, done: number, claims: Map<string, AuditClaim>, dueOn: Date | null, now = new Date()) {
  const holding = [...claims.values()].filter((c) => claimLive(c, now)).length;
  return { left, done, holding, pace: pace(left, dueOn, now) };
}
