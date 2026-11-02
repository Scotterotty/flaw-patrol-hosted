import { notFound } from "next/navigation";
import { RunImporter } from "@/components/run-importer";
import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { libraryProjectIds } from "@/lib/umbrella";

export const metadata = { title: "Import a run" };

export default async function ImportRunPage({ params }: { params: Promise<{ key: string }> }) {
  const { project, who } = await projectAccess((await params).key);
  if (!can(who, "run:import")) notFound();
  const suites = await db.testSuite.findMany({ where: { projectId: { in: await libraryProjectIds(project) }, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    // Same width as Test runs, and only the top bar's breadcrumb (ver_54 audit #5, #6).
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Import a run" subtitle="Bring in a run that was tracked in a spreadsheet: its step results, case results and testers. The run stays open so you can finish it here." />
      <RunImporter projectId={project.id} projectKey={project.key} suites={suites} />
    </div>
  );
}
