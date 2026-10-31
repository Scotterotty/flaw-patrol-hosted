import { notFound } from "next/navigation";
import { CustomReportView } from "@/components/custom-reports";
import { PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { queryObject, reportQuery } from "@/lib/custom-report-data";
import { releasesFor, reportsFor, umbrellaScope } from "@/lib/custom-report-scope";
import { requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";

export const metadata = { title: "Custom report" };

/** One custom report of an umbrella (ver_101), across its test cycles, narrowed by platform. */
export default async function UmbrellaCustomReport({ params, searchParams }: { params: Promise<{ id: string; rid: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { id, rid } = await params;
  const sp = await searchParams;
  const u = await loadUmbrella(id, user);
  if (!u) notFound();
  const report = (await reportsFor(u.hub.id, user, u.who)).find((r) => r.id === rid);
  if (!report) notFound();
  const platform = queryObject(reportQuery(report.query, sp)).platform ?? "";
  const cs = await umbrellaScope(u, user, platform);
  const platforms = [...new Set([...u.platforms.map((p) => p.name), ...u.projects.map((p) => p.platform).filter(Boolean)])];
  const g = `/g/${u.group.id}`;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle={u.group.name} />
      <ViewTabs
        label="Reports"
        tabs={[
          { label: "Run reports", href: `${g}/reports`, current: false },
          { label: "Release status", href: `${g}/rc`, current: false },
          { label: "Requirements", href: `${g}/stories`, current: false },
          { label: "Bug bashes", href: `/p/${u.hub.key}/bashes`, current: false },
          { label: "Custom reports", href: `${g}/reports/custom`, current: true },
        ]}
      />
      <CustomReportView cs={cs} report={report} sp={sp} releases={await releasesFor(cs)} platformList={u.platforms} platforms={platforms} preparedBy={user.name ?? user.email} />
    </div>
  );
}
