import { AutoFilterForm } from "@/components/auto-filter-form";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { LocalDefectStatus, RefreshJiraButton, SendToJiraButton } from "@/components/defect-controls";
import { Badge, Card, EmptyState, PageHeader, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { caseKey, relativeTime } from "@/lib/format";
import { refreshDefectStatuses } from "@/lib/jira";
import { can } from "@/lib/permissions";
import { projectAccess, mySpelling } from "@/lib/session";
import { SEVERITY_TONE } from "@/lib/severity";
import { severityScaleFor } from "@/lib/severity-server";
import { sendToJiraData } from "@/lib/send-to-jira";
import { redirect } from "next/navigation";
import { BugAnswers } from "@/components/bug-answers";
import { BugDescription } from "@/components/bug-description";
import { parseAnswers } from "@/lib/bug-layout";
import { LastCheckLine } from "@/components/known-bugs-panel";
import { cycleSettingsHref, hubGroupId, jiraConfigFor } from "@/lib/umbrella";

export const metadata = { title: "Bugs" };

export default async function DefectsPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ status?: string; severity?: string; jira?: string; version?: string }> }) {
  const spelling = await mySpelling();
  const { key } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  // An umbrella's hub shows its runs and bugs on the umbrella's own pages.
  const umbrellaId = await hubGroupId(project.id);
  if (umbrellaId) redirect(`/g/${umbrellaId}/bugs`);
  const jira = await jiraConfigFor(project.id);
  // Keep Jira statuses reasonably fresh without a webhook (only re-fetches stale ones).
  if (jira) await refreshDefectStatuses(project.id).catch(() => null);

  const where: Prisma.DefectWhereInput = { projectId: project.id };
  if (sp.status === "open") where.status = "OPEN";
  if (sp.status === "resolved") where.status = { not: "OPEN" };
  if (sp.severity) where.severity = sp.severity as Prisma.DefectWhereInput["severity"];
  // Bugs saved before Jira was connected (ver_91).
  if (sp.jira === "local") where.externalKey = null;
  // Found-in version (ver_141).
  if (sp.version) where.foundIn = sp.version;
  const versions = (await db.defect.findMany({ where: { projectId: project.id, foundIn: { not: "" } }, distinct: ["foundIn"], orderBy: { createdAt: "desc" }, take: 30, select: { foundIn: true } })).map((d) => d.foundIn);
  const scale = await severityScaleFor(project.id);
  const defects = await db.defect.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      links: {
        include: { result: { select: { createdAt: true, entryId: true, run: { select: { number: true, name: true, release: true } }, entry: { select: { title: true, testCase: { select: { number: true, project: { select: { key: true } } } } } } } } },
      },
      checks: { orderBy: { createdAt: "desc" }, take: 1, select: { outcome: true, byName: true, createdAt: true, run: { select: { number: true } } } },
    },
  });

  // Send to Jira (ver_91): open bugs saved before Jira was connected, for those who can file bugs.
  const canSend = !!jira && can(who, "run:execute");
  const notInJira = canSend ? await db.defect.count({ where: { projectId: project.id, externalKey: null, status: "OPEN" } }) : 0;
  const sendable = canSend
    ? await sendToJiraData(defects.filter((d) => !d.externalKey && d.status === "OPEN").map((d) => ({ id: d.id, projectId: project.id, number: d.number, title: d.title, severity: d.severity, label: `D-${d.number}` })))
    : new Map();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Bugs"
        subtitle={
          jira ? (
            `Bugs found while testing, linked to Jira project ${jira.jiraProjectKey}.`
          ) : (
            <>
              Bugs found while testing.{" "}
              <Link href={await cycleSettingsHref(project, user, "jira")} className="text-accent-700 hover:underline">
                Connect Jira
              </Link>{" "}
              to file them straight into Jira.
            </>
          )
        }
        actions={jira && can(who, "run:execute") ? <RefreshJiraButton projectId={project.id} /> : null}
      />
      {notInJira > 0 && sp.jira !== "local" && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="not-in-jira">
          {notInJira === 1 ? "1 bug isn't" : `${notInJira} bugs aren't`} in Jira yet.{" "}
          <Link href="?jira=local&status=open" className="font-medium underline">
            Send {notInJira === 1 ? "it" : "them"} to Jira
          </Link>
        </p>
      )}
      <AutoFilterForm className="mb-4 flex flex-wrap gap-2">
        {sp.jira === "local" && <input type="hidden" name="jira" value="local" />}
        <Select name="status" defaultValue={sp.status ?? ""} className="w-auto" aria-label="Status">
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="resolved">Fixed or closed</option>
        </Select>
        <Select name="severity" defaultValue={sp.severity ?? ""} className="w-auto" aria-label="Severity">
          <option value="">Any severity</option>
          {scale.levels.map((s) => (
            <option key={s} value={s}>
              {scale.labels[s]}
            </option>
          ))}
        </Select>
        {(versions.length > 0 || sp.version) && (
          <Select name="version" defaultValue={sp.version ?? ""} className="w-auto" aria-label="Found in version">
            <option value="">Any version</option>
            {[...new Set([...versions, ...(sp.version ? [sp.version] : [])])].map((v) => (
              <option key={v} value={v}>
                Found in {v}
              </option>
            ))}
          </Select>
        )}
      </AutoFilterForm>
      {defects.length === 0 ? (
        <EmptyState title="No bugs">When a tester reports a bug from a test step, it shows up here with the run and case it came from.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Bug</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Severity</th>
                <th className="px-4 py-2 font-medium">Found in</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Reported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {defects.map((d) => {
                const found = [...new Map(d.links.map((l) => [l.result.entryId, l])).values()];
                return (
                  <tr key={d.id} id={d.externalKey ? undefined : `D-${d.number}`} className="scroll-mt-20 align-top target:bg-accent-50">
                    <td className="px-4 py-2">
                      {d.externalUrl ? (
                        <a href={d.externalUrl} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium text-accent-700 hover:underline">
                          {d.externalKey}
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-slate-500">D-{d.number}</span>
                      )}{" "}
                      <span className="text-slate-900">{d.title}</span>
                      {canSend && !d.externalKey && <span className="mt-0.5 block text-xs text-slate-500">Saved before Jira was connected</span>}
                      <LastCheckLine check={d.checks[0]} spelling={spelling} />
                      {d.answers == null && !d.externalKey && <BugDescription text={d.description} />}
                      {d.answers != null && <BugAnswers projectId={project.id} defectId={d.id} templateName={d.templateName} answers={parseAnswers(d.answers)} canAdd={can(who, "run:execute") && d.status === "OPEN"} inJira={!!d.externalKey} />}
                    </td>
                    <td className="px-4 py-2">
                      {d.externalKey ? (
                        <Badge tone={d.status === "OPEN" ? "red" : "green"}>{d.externalStatus ?? (d.status === "OPEN" ? "Open" : "Fixed")}</Badge>
                      ) : can(who, "defect:edit") ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <LocalDefectStatus projectId={project.id} defect={d} />
                          {sendable.has(d.id) && <SendToJiraButton data={sendable.get(d.id)!} />}
                        </span>
                      ) : (
                        <Badge tone={d.status === "OPEN" ? "red" : "green"}>{d.status.toLowerCase()}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={SEVERITY_TONE[d.severity]} className="whitespace-nowrap">
                        {scale.labels[d.severity]}
                      </Badge>
                      {d.externalPriority && <p className="mt-1 text-xs whitespace-nowrap text-slate-500">Priority: {d.externalPriority}</p>}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {d.foundIn && (
                        <p className="mb-0.5 font-medium text-slate-700" data-testid="bug-found-in">
                          Version {d.foundIn}
                        </p>
                      )}
                      {found.map((l) => (
                        <p key={l.result.entryId}>
                          <Link href={`/p/${project.key}/runs/${l.result.run.number}/execute?entry=${l.result.entryId}`} className="hover:underline">
                            {caseKey(l.result.entry.testCase.project.key, l.result.entry.testCase.number)}
                            {l.stepIndex !== null && ` step ${l.stepIndex + 1}`} in R{l.result.run.number}
                          </Link>
                          {l.result.run.release && <span className="text-slate-500"> · {l.result.run.release}</span>}
                        </p>
                      ))}
                      {found.length === 0 && <span className="text-slate-400">Not linked to a result yet</span>}
                    </td>
                    <td className="hidden px-4 py-2 text-xs text-slate-500 md:table-cell">
                      {d.createdBy} · {relativeTime(d.createdAt, spelling)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
