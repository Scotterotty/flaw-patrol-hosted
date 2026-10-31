import { AddPartBar } from "@/components/add-part-bar";
import { RcReport } from "@/components/rc-page";
import { PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { projectAccess } from "@/lib/session";

export const metadata = { title: "Release status" };

/** Reports → Release status: starts with this project's runs of the RC; runs from other projects can be added. */
export default async function ProjectRcPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ release?: string }> }) {
  const { project, user, who } = await projectAccess((await params).key);
  const base = `/p/${project.key}/reports`;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle="A quick look at how testing of a release is going on each platform." />
      <ViewTabs
        label="Reports"
        tabs={[
          { label: "Run reports", href: base, current: false },
          { label: "Release status", href: `${base}/rc`, current: true },
          { label: "Requirements", href: `${base}/stories`, current: false },
          { label: "Bug bashes", href: `/p/${project.key}/bashes`, current: false },
          { label: "Custom reports", href: `/p/${project.key}/reports/custom`, current: false },
        ]}
      />
      <AddPartBar homeId={project.id} user={user} who={who} base={`${base}/custom`} part="rc" title="Release status summary" />
      <RcReport
        user={user}
        want={(await searchParams).release}
        base={`${base}/rc`}
        scope={{ projectIds: [project.id], addAnywhere: true }}
        scopeNote={`${project.name}'s runs of this release, plus any you added.`}
        exportUrl={`/p/${project.key}/reports/export`}
        wrapScope={{ projectKey: project.key }}
        cycle
      />
    </div>
  );
}
