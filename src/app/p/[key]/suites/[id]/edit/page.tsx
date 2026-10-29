import { CrumbName } from "@/components/crumb-name";
import { notFound } from "next/navigation";
import { SuiteEditor } from "@/components/suite-editor";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { suitePickerData } from "@/lib/suite-data";

export const metadata = { title: "Edit test suite" };

export default async function EditSuitePage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const { project, who } = await projectAccess(key);
  if (!can(who, "suite:manage")) notFound();
  const suite = await db.testSuite.findFirst({ where: { id, projectId: project.id }, include: { cases: { orderBy: { position: "asc" } } } });
  if (!suite) notFound();
  const data = await suitePickerData(project);
  return (
    <>
    <CrumbName href={`/p/${project.key}/suites/${suite.id}`} label={suite.name} />
    <SuiteEditor
      projectId={project.id}
      projectKey={project.key}
      suiteId={suite.id}
      initial={{ name: suite.name, description: suite.description, caseIds: suite.cases.map((c) => c.caseId) }}
      {...data}
    />
    </>
  );
}
