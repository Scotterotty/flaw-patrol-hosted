import { notFound } from "next/navigation";
import { CustomReportView } from "@/components/custom-reports";
import { PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { cycleScope, releasesFor, reportsFor } from "@/lib/custom-report-scope";
import { projectAccess } from "@/lib/session";

export const metadata = { title: "Custom report" };

/** One custom report of a test cycle (ver_101): read it, or edit it with ?edit=1. */
export default async function CycleCustomReport({ params, searchParams }: { params: Promise<{ key: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key, id } = await params;
  const sp = await searchParams;
  const { project, user, who } = await projectAccess(key);
  const report = (await reportsFor(project.id, user, who)).find((r) => r.id === id);
  if (!report) notFound();
  const cs = await cycleScope(project, user);
  const base = `/p/${project.key}/reports`;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle={project.name} />
      <ViewTabs
        label="Reports"
        tabs={[
          { label: "Run reports", href: base, current: false },
          { label: "Release status", href: `${base}/rc`, current: false },
          { label: "Requirements", href: `${base}/stories`, current: false },
          { label: "Bug bashes", href: `/p/${project.key}/bashes`, current: false },
          { label: "Custom reports", href: `${base}/custom`, current: true },
        ]}
      />
      <CustomReportView cs={cs} report={report} sp={sp} releases={await releasesFor(cs)} preparedBy={user.name ?? user.email} />
    </div>
  );
}
