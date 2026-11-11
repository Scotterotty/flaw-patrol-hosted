import { platformNamesFor, tagColorsFor } from "@/lib/tag-data";
import { notFound } from "next/navigation";
import { CaseEditor } from "@/components/case-editor";
import { hubGroupId } from "@/lib/umbrella";
import { editorContext } from "@/lib/case-data";
import { BLANK_CHARTER, parseCharter } from "@/lib/charter";
import { can } from "@/lib/permissions";
import { charterHome, teamTemplates } from "@/lib/charter-data";
import { templateById } from "@/lib/charter-templates";
import { projectAccess, requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { firstDay } from "@/lib/first-day";

export const metadata = { title: "New test case" };

export default async function NewCasePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ folder?: string; charter?: string; persona?: string; explore?: string; minutes?: string; template?: string; title?: string; story?: string }> }) {
  const { key } = await params;
  const { folder, charter, persona, explore, minutes, template, title, story } = await searchParams;
  const isCharter = charter === "1";
  const { project, who } = await projectAccess(key);
  if (!can(who, "case:edit")) notFound();
  const ctx = await editorContext(project.id, [], null, isCharter);
  // From a tour or checklist: the template fills in everything but the area.
  // ver_216: More details stays open for people who opened it last time.
  const me = await requireUser();
  const prefs = firstDay((await db.user.findUnique({ where: { id: me.id }, select: { openCards: true } }))?.openCards);
  // The folder you came from; with only one folder there's nowhere else it could go.
  const startFolder = ctx.folders.some((f) => f.id === folder) ? folder! : ctx.folders.length === 1 ? ctx.folders[0].id : null;
  const tpl = isCharter && template ? templateById(template, await teamTemplates((await charterHome(project)).id)) : null;
  return (
    <CaseEditor
      linkTo={story && /^[A-Z][A-Z0-9_]*-\d+$/.test(story) ? story : undefined}
      tagColors={await tagColorsFor(project.id)}
      platformNames={await platformNamesFor(project.id)}
      areaSkip={project.areaSkip}
      inLibrary={!!(await hubGroupId(project.id))}
      projectId={project.id}
      projectKey={project.key}
      caseId={null}
      number={null}
      version={null}
      initial={{
        title: (title ?? "").slice(0, 500),
        preconditions: "",
        priority: "MEDIUM",
        type: isCharter ? "EXPLORATORY" : "MANUAL",
        automationId: null,
        tags: [],
        folderId: startFolder,
        steps: [],
        // "Write charter" on a persona and "Turn into charter" on a session idea arrive with these filled in.
        charter: isCharter
          ? parseCharter({ ...BLANK_CHARTER, ...(tpl && { with: tpl.with, discover: tpl.discover, prompts: tpl.prompts, minutes: tpl.minutes }), explore: (explore ?? "").slice(0, 2000), ...(Number(minutes) > 0 && { minutes: Number(minutes) }) })
          : null,
        personaId: ctx.personas.some((p) => p.id === persona) ? persona! : null,
      }}
      personas={ctx.personas}
      folderOptions={ctx.folderOptions}
      sharedSteps={ctx.sharedSteps}
      knownTags={ctx.knownTags}
      canManageShared={can(who, "shared:manage")}
      detailsOpen={prefs.caseDetails}
    />
  );
}
