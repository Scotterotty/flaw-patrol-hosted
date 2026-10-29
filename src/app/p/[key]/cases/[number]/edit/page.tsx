import { platformNamesFor, tagColorsFor } from "@/lib/tag-data";
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

export default async function EditCasePage({ params, searchParams }: { params: Promise<{ key: string; number: string }>; searchParams: Promise<{ req?: string; queue?: string; at?: string; total?: string; back?: string }> }) {
  const { key, number } = await params;
  const sp = await searchParams;
  const { project, who } = await projectAccess(key);
  if (!can(who, "case:edit")) notFound();
  const c = await loadCase(project.id, number);
  const steps = parseCaseSteps(c.versions[0]?.steps);
  const ctx = await editorContext(project.id, sharedStepIdsIn(steps), c.personaId, c.type === "EXPLORATORY");
  // Create and write steps on the Requirements page (ver_96): the other new cases wait in `queue`.
  const story = sp.req && /^[A-Z][A-Z0-9_]*-\d+$/.test(sp.req) ? sp.req : null;
  const rest = (sp.queue ?? "").split(",").filter((n) => /^\d+$/.test(n));
  const total = Math.max(Number(sp.total) || 1, rest.length + 1);
  const at = Math.min(Number(sp.at) || 1, total);
  const back = sp.back?.startsWith(`/p/${project.key}/stories?`) ? sp.back : `/p/${project.key}/stories?${new URLSearchParams({ open: story ?? "", made: String(total) })}`;
  const queue = story
    ? {
        story,
        at,
        total,
        next: rest.length ? `/p/${project.key}/cases/${rest[0]}/edit?${new URLSearchParams({ req: story, queue: rest.slice(1).join(","), at: String(at + 1), total: String(total), back })}` : null,
        back,
      }
    : undefined;
  return (
    <CaseEditor
      queue={queue}
      tagColors={await tagColorsFor(project.id)}
      platformNames={await platformNamesFor(project.id)}
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
