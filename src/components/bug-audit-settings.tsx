"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { endBugAudit, saveBugAudit } from "@/server/bug-audit";
import { useCloseRow } from "./settings-row";
import { Button, ErrorText, Field, Input } from "./ui";

export type AuditSettings = { id: string; name: string; filter: string; label: string; dueOn: string } | null;

/**
 * Umbrella Settings → Bug audit (ver_250). The Audit button on Bugs only shows once a Jira
 * filter is saved here, and goes away again when the audit is ended.
 */
export function BugAuditSettings({ groupId, audit, canEdit }: { groupId: string; audit: AuditSettings; canEdit: boolean }) {
  const router = useRouter();
  const close = useCloseRow();
  const year = new Date().getFullYear();
  const [s, setS] = useState({ name: audit?.name ?? `${year} bug audit`, filter: audit?.filter ?? "", label: audit?.label ?? `${year}audit`, dueOn: audit?.dueOn ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      data-testid="bug-audit-settings"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveBugAudit(groupId, s);
          if (!r.ok) return setError(r.error);
          setError(null);
          router.refresh();
          close();
        });
      }}
    >
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <p className="text-sm text-slate-700">
        Check a Jira filter of old bugs as a team, before a bug bash. Each person presses Next bug, checks it, and marks what they found. Flaw Patrol adds the label below to the bug in Jira, whatever they found, so it drops off the filter. Bugs that still happen stay open.
      </p>
      <Field label="Jira filter" hint="The filter's link or number, like magnopus.atlassian.net/issues/?filter=23539. It should leave out bugs that already have the label. JQL works too.">
        <Input value={s.filter} disabled={!canEdit} onChange={(e) => setS({ ...s, filter: e.target.value })} placeholder="https://your-site.atlassian.net/issues/?filter=12345" className="w-full" aria-label="Jira filter" />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field label="Name">
          <Input value={s.name} disabled={!canEdit} onChange={(e) => setS({ ...s, name: e.target.value })} className="w-56" aria-label="Audit name" />
        </Field>
        <Field label="Label for checked bugs" hint="No spaces.">
          <Input value={s.label} disabled={!canEdit} onChange={(e) => setS({ ...s, label: e.target.value.replace(/[\s,]/g, "") })} className="w-40" aria-label="Label for checked bugs" />
        </Field>
        <Field label="Finish by" hint="Usually the bug bash. Sets the pace on the Audit page.">
          <Input type="date" value={s.dueOn} disabled={!canEdit} onChange={(e) => setS({ ...s, dueOn: e.target.value })} className="w-auto" aria-label="Finish by" />
        </Field>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {audit ? "Save" : "Start the audit"}
          </Button>
          <Button onClick={close}>Cancel</Button>
          {audit && (
            <>
              <Link href={`/g/${groupId}/bugs/audit`} className="text-sm text-accent-700 hover:underline">
                Open the Audit page
              </Link>
              <Button
                variant="ghost"
                className="ml-auto"
                disabled={pending}
                onClick={() => {
                  if (!confirm("End the audit? Its results stay, and the Audit button goes away from Bugs. Nothing changes in Jira.")) return;
                  start(async () => {
                    const r = await endBugAudit(audit.id);
                    if (!r.ok) return setError(r.error);
                    router.refresh();
                    close();
                  });
                }}
              >
                End the audit
              </Button>
            </>
          )}
        </div>
      )}
    </form>
  );
}
