import { notFound } from "next/navigation";
import { StoryReport } from "@/components/story-report";
import { PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { requireUser } from "@/lib/session";
import { newestRcNames } from "@/lib/story-coverage";
import { loadUmbrella } from "@/lib/umbrella";

export const metadata = { title: "Requirement coverage" };

/** Umbrella Reports → Stories: one column per current test cycle. */
export default async function UmbrellaStoriesReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ release?: string }> }) {
  const user = await requireUser();
  const u = await loadUmbrella((await params).id, user);
  if (!u) notFound();
  const g = `/g/${u.group.id}`;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle={`Which Jira requirements have cases, and how they did in each ${u.group.name} test cycle.`} />
      <ViewTabs
        label="Reports"
        tabs={[
          { label: "Run reports", href: `${g}/reports`, current: false },
          { label: "Release status", href: `${g}/rc`, current: false },
          { label: "Requirements", href: `${g}/stories`, current: true },
          { label: "Bug bashes", href: `/p/${u.hub.key}/bashes`, current: false },
        ]}
      />
      <StoryReport
        projectId={u.hub.id}
        libraryIds={[u.hub.id]}
        columns={u.current.map((p) => ({ id: p.id, key: p.key, name: p.name }))}
        want={(await searchParams).release}
        rcNames={await newestRcNames(u.current)}
        base={`${g}/stories`}
        scopeNote="each current test cycle's runs"
        exportTo={{ url: `${g}/reports/export`, cycle: false, preparedBy: user.name ?? user.email }}
      />
    </div>
  );
}
