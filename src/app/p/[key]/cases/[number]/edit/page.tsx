import { notFound } from "next/navigation";
import { CaseEditor } from "@/components/case-editor";
import { hubGroupId } from "@/lib/umbrella";
import { editorContext } from "@/lib/case-data";
import { parseCharter } from "@/lib/charter";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";
import { parseCaseSteps, sharedStepIdsIn } from "@/lib/steps";
import { loadCase } from "../load";
import { StoryLinks } from "@/components/story-links";
import { storyInfo } from "@/lib/stories";
import { jiraConfigFor } from "@/lib/umbrella";

export const metadata = { title: "Edit test case" };

export default async function EditCasePage({ params }: { params: Promise<{ key: string; number: string }> }) {
  const { key, number } = await params;
  const { project, who } = await projectAccess(key);
  if (!can(who, "case:edit")) notFound();
  const c = await loadCase(project.id, number);
  const steps = parseCaseSteps(c.versions[0]?.steps);
  const ctx = await editorContext(project.id, sharedStepIdsIn(steps), c.personaId, c.type === "EXPLORATORY");
  return (
    <CaseEditor
      inLibrary={!!(await hubGroupId(project.id))}
      projectId={project.id}
      projectKey={project.key}
      caseId={c.id}
      number={c.number}
      version={c.currentVersion}
      initial={{
        title: c.title,
        preconditions: c.preconditions,
        priority: c.priority,
        type: c.type,
        automationId: c.automationId,
        tags: c.tags,
        folderId: c.folderId,
        steps,
        charter: c.type === "EXPLORATORY" ? parseCharter(c.versions[0]?.charter) : null,
        personaId: c.personaId,
      }}
      personas={ctx.personas}
      folderOptions={ctx.folderOptions}
      sharedSteps={ctx.sharedSteps}
      knownTags={ctx.knownTags}
      canManageShared={can(who, "shared:manage")}
      extra={c.type !== "EXPLORATORY" && <StoryLinks projectId={project.id} caseId={c.id} stories={[...(await storyInfo(project.id, c.jiraStories)).values()]} canEdit jira={!!(await jiraConfigFor(project.id))} />}
    />
  );
}
