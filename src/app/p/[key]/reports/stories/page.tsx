import { StoryReport } from "@/components/story-report";
import { PageHeader } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs";
import { projectAccess } from "@/lib/session";
import { newestRcNames } from "@/lib/story-coverage";
import { libraryProjectIds } from "@/lib/umbrella";

export const metadata = { title: "Requirement coverage" };

/** Reports → Stories: which of a Jira release's stories this test cycle's runs cover. */
export default async function ProjectStoriesReport({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ release?: string }> }) {
  const { project, user } = await projectAccess((await params).key);
  const base = `/p/${project.key}/reports`;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle="Which Jira requirements have cases, and how they did in this test cycle." />
      <ViewTabs
        label="Reports"
        tabs={[
          { label: "Run reports", href: base, current: false },
          { label: "Release status", href: `${base}/rc`, current: false },
          { label: "Requirements", href: `${base}/stories`, current: true },
          { label: "Bug bashes", href: `/p/${project.key}/bashes`, current: false },
        ]}
      />
      <StoryReport
        projectId={project.id}
        libraryIds={await libraryProjectIds(project)}
        columns={[{ id: project.id, key: project.key, name: project.name }]}
        want={(await searchParams).release}
        rcNames={await newestRcNames([project])}
        base={`${base}/stories`}
        scopeNote="this test cycle's runs only"
        exportTo={{ url: `/p/${project.key}/reports/export`, cycle: true, preparedBy: user.name ?? user.email }}
      />
    </div>
  );
}
