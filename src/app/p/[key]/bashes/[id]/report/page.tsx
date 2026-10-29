import { notFound } from "next/navigation";
import { BashReportView } from "@/components/bash-report";
import { CrumbName } from "@/components/crumb-name";
import { bashReport, reportData } from "@/lib/bash-page";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { jiraConfigFor } from "@/lib/umbrella";

export const metadata = { title: "Bug bash report" };

/** The one-page bug bash report (ver_93), also listed on Reports → Bug bashes. */
export default async function BashReportPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const { project, user, who } = await projectAccess(key);
  const r = await bashReport(id);
  if (!r || r.bash.projectId !== project.id) notFound();
  // File this bug… (ver_94) is for whoever started it, or a lead.
  const runProjectId = r.bash.run?.projectId ?? r.bash.projectId;
  const file = r.bash.createdById === user.id || can(who, "run:manage") ? { projectId: runProjectId, jiraConnected: !!(await jiraConfigFor(runProjectId)) } : undefined;
  return (
    <div className="mx-auto max-w-6xl">
      <CrumbName href={`/p/${project.key}/bashes/${id}/report`} label={`Report · ${r.bash.name}`} />
      <BashReportView r={reportData(r, file)} />
    </div>
  );
}
