import { notFound } from "next/navigation";
import { CustomReportsList } from "@/components/custom-reports";
import { PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { reportTabs } from "@/lib/tools";
import { reportsFor, umbrellaScope } from "@/lib/custom-report-scope";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";

export const metadata = { title: "Custom reports" };

/** An umbrella's Reports → Custom reports (ver_101), kept on its hub like Saved views. */
export default async function UmbrellaCustomReports({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  const [cs, reports] = await Promise.all([umbrellaScope(u, user, ""), reportsFor(u.hub.id, user, u.who)]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle={`Your own reports, made from parts of ${u.group.name}'s other tabs.`} />
      <ViewTabs
        label="Reports"
        tabs={reportTabs({ g: u.group.id, hub: u.hub.key, tools: u.tools }, "custom")}
      />
      <CustomReportsList cs={cs} reports={reports} canCreate={can(u.who, "run:execute")} />
    </div>
  );
}
