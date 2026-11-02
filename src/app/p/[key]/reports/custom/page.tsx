import { CustomReportsList } from "@/components/custom-reports";
import { PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { cycleScope, reportsFor } from "@/lib/custom-report-scope";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";

export const metadata = { title: "Custom reports" };

/** Reports → Custom reports: reports put together from parts of the other tabs. */
export default async function CycleCustomReports({ params }: { params: Promise<{ key: string }> }) {
  const { project, user, who } = await projectAccess((await params).key);
  const base = `/p/${project.key}/reports`;
  const [cs, reports] = await Promise.all([cycleScope(project, user), reportsFor(project.id, user, who)]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle="Your own reports, made from parts of the other tabs." />
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
      <CustomReportsList cs={cs} reports={reports} canCreate={can(who, "run:execute")} />
    </div>
  );
}
