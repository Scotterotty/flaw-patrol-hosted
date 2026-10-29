import { notFound } from "next/navigation";
import { SuiteEditor } from "@/components/suite-editor";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { suitePickerData } from "@/lib/suite-data";

export const metadata = { title: "New test suite" };

export default async function NewSuitePage({ params }: { params: Promise<{ key: string }> }) {
  const { project, who } = await projectAccess((await params).key);
  if (!can(who, "suite:manage")) notFound();
  const data = await suitePickerData(project);
  return <SuiteEditor projectId={project.id} projectKey={project.key} suiteId={null} initial={{ name: "", description: "", caseIds: [] }} {...data} />;
}
