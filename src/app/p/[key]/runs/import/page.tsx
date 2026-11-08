import { notFound } from "next/navigation";
import { runTitle } from "@/lib/run-label";
import { RunImporter } from "@/components/run-importer";
import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { libraryProjectIds } from "@/lib/umbrella";
import { NOT_BASH_RUN } from "@/lib/bash-cases";

export const metadata = { title: "Import a run" };

export default async function ImportRunPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ run?: string; sheet?: string }> }) {
  const { project, who } = await projectAccess((await params).key);
  if (!can(who, "run:import")) notFound();
  const sp = await searchParams;
  const [suites, active] = await Promise.all([
    db.testSuite.findMany({ where: { projectId: { in: await libraryProjectIds(project) }, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Where should the results go: the runs still in progress here (not automated, not a bug bash).
    db.testRun.findMany({
      where: { projectId: project.id, state: "ACTIVE", automated: false, ...NOT_BASH_RUN },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, name: true, build: true, createdAt: true, entries: { select: { status: true } } },
    }),
  ]);
  const runs = active.map((r) => ({ id: r.id, number: r.number, name: r.name, title: runTitle(r), total: r.entries.length, tested: r.entries.filter((e) => e.status !== "UNTESTED").length }));
  return (
    // Same width as Test runs, and only the top bar's breadcrumb (ver_54 audit #5, #6).
    <div className="max-w-6xl">
      <PageHeader title="Import a run" subtitle={`Import results tracked in a spreadsheet for ${project.name}: step results, case results and testers. Add them to a run in progress, or make a new run.`} />
      <RunImporter projectId={project.id} projectKey={project.key} suites={suites} runs={runs} pickRun={sp.run} handoff={sp.sheet === "handoff"} />
    </div>
  );
}
