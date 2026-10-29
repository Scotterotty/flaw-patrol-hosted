import { notFound } from "next/navigation";
import { SharedStepEditor } from "@/components/shared-step-editor";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";

export const metadata = { title: "New shared step" };

export default async function NewSharedStepPage({ params }: { params: Promise<{ key: string }> }) {
  const { project, who } = await projectAccess((await params).key);
  if (!can(who, "shared:manage")) notFound();
  return (
    <SharedStepEditor
      projectId={project.id}
      projectKey={project.key}
      sharedStepId={null}
      usageCount={0}
      initial={{ name: "", description: "", parameters: [], steps: [] }}
    />
  );
}
