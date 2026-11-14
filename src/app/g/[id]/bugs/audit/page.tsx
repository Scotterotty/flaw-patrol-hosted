import Link from "next/link";
import { notFound } from "next/navigation";
import { BugViewSwitch } from "@/components/bug-board";
import { AuditWorkbench, type AuditListBug, type AuditRecent } from "@/components/bug-audit";
import { EmptyState, PageHeader } from "@/components/ui";
import { claimLive } from "@/lib/bug-audit";
import { auditClaims, auditIssues, auditProgress } from "@/lib/bug-audit-server";
import { db } from "@/lib/db";
import { JiraError, jiraFor } from "@/lib/jira";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { jiraConfigFor, loadUmbrella } from "@/lib/umbrella";

export const metadata = { title: "Bug audit" };

/** Bugs → Audit (ver_250): the team works through the audit's Jira filter one bug at a time. */
export default async function BugAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const u = await loadUmbrella(id, user);
  if (!u) notFound();
  const [jira, audit] = await Promise.all([jiraConfigFor(u.hub.id), db.bugAudit.findFirst({ where: { groupId: id, endedAt: null }, orderBy: { createdAt: "desc" } })]);
  const settings = `/g/${id}/settings#bug-audit`;
  const header = (subtitle: string) => <PageHeader title="Bugs" beside={<BugViewSwitch view="audit" audit={`/g/${id}/bugs/audit`} base={`/g/${id}/bugs`} />} subtitle={subtitle} />;
  if (!jira || !audit) {
    return (
      <div className="page page-list">
        {header("Check a Jira filter of old bugs as a team.")}
        <EmptyState title="No bug audit is going" action={can(u.who, "jira:manage") ? <Link href={settings} className="text-sm font-medium text-accent-700 hover:underline">Set one up in Settings</Link> : undefined}>
          {jira ? "An admin starts one in Settings → Bug audit by pasting a Jira filter link." : "Connect Jira in Settings first."}
        </EmptyState>
      </div>
    );
  }
  const canCheck = can(u.who, "run:execute") && !u.group.archivedAt;
  let issues: AuditListBug[] = [];
  let more = false;
  let done = 0;
  let error: string | null = null;
  try {
    const client = await jiraFor(u.hub.id);
    if (client) ({ issues, more, done } = await auditIssues(audit, client));
  } catch (e) {
    error = e instanceof JiraError ? e.message : "Couldn't read the audit's filter from Jira.";
  }
  const claims = await auditClaims(audit.id);
  const now = new Date();
  const progress = auditProgress(issues.length, done, claims, audit.dueOn, now);
  const holders = Object.fromEntries(
    [...claims.values()].filter((c) => claimLive(c, now)).map((c) => [c.issueKey, { name: c.claimedBy.split(/\s+/)[0], mine: c.claimedById === user.id }]),
  );
  const recent: AuditRecent[] = (
    await db.bugAuditCheck.findMany({ where: { auditId: audit.id, checkedAt: { not: null } }, orderBy: { checkedAt: "desc" }, take: 40, select: { issueKey: true, title: true, outcome: true, clients: true, checkedBy: true, checkedAt: true, movedTo: true } })
  ).map((r) => ({ ...r, checkedAt: r.checkedAt!.toISOString() }));
  const site = jira.siteUrl.replace(/\/+$/, "");
  const filterUrl = audit.filterId ? `${site}/issues/?filter=${audit.filterId}` : `${site}/issues/?jql=${encodeURIComponent(audit.jql)}`;
  return (
    <div className="page page-list">
      {header(`${audit.name}: pick a bug, check it, mark what you found. Each checked bug gets the ${audit.label} label in Jira.`)}
      <AuditWorkbench
        groupId={id}
        audit={{ id: audit.id, name: audit.name, label: audit.label, filterUrl, settings: can(u.who, "jira:manage") ? settings : null }}
        site={site}
        issues={issues}
        more={more}
        holders={holders}
        progress={progress}
        recent={recent}
        platforms={u.platforms.map((p) => p.name)}
        canCheck={canCheck}
        error={error}
      />
    </div>
  );
}
