import { CrumbName } from "@/components/crumb-name";
import { notFound } from "next/navigation";
import { SharedStepEditor } from "@/components/shared-step-editor";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { parseParams, parsePlainSteps } from "@/lib/steps";
import { loadSharedStep } from "../load";

export const metadata = { title: "Edit shared step" };

export default async function EditSharedStepPage({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const { project, who } = await projectAccess(key);
  if (!can(who, "shared:manage")) notFound();
  const s = await loadSharedStep(project.id, id);
  const v = s.versions[0];
  return (
    <>
    <CrumbName href={`/p/${project.key}/shared-steps/${s.id}`} label={s.name} />
    <SharedStepEditor
      projectId={project.id}
      projectKey={project.key}
      sharedStepId={s.id}
      usageCount={s.usages.length}
      initial={{ name: s.name, description: s.description, parameters: parseParams(v?.parameters), steps: parsePlainSteps(v?.steps) }}
    />
    </>
  );
}
