import { notFound } from "next/navigation";
import { RcReport } from "@/components/rc-page";
import { PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";

export const metadata = { title: "Release status" };

/** How each of the umbrella's RC runs is going. Only runs from its own projects ever show here. */
export default async function UmbrellaRcPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ release?: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Reports" subtitle={`A quick look at how each ${u.group.name} release is going, one column per platform.`} />
      <ViewTabs
        label="Reports"
        tabs={[
          { label: "Run reports", href: `/g/${u.group.id}/reports`, current: false },
          { label: "Release status", href: `/g/${u.group.id}/rc`, current: true },
          { label: "Requirements", href: `/g/${u.group.id}/stories`, current: false },
          { label: "Bug bashes", href: `/p/${u.hub.key}/bashes`, current: false },
        ]}
      />
      <RcReport
        user={user}
        want={(await searchParams).release}
        base={`/g/${u.group.id}/rc`}
        scope={{ projectIds: [u.hub.id, ...u.projects.map((p) => p.id)], addAnywhere: false }}
        scopeNote={`${u.group.name}'s runs of this release.`}
        exportUrl={`/g/${u.group.id}/reports/export`}
      />
    </div>
  );
}
