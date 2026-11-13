import { notFound } from "next/navigation";
import { TemplateGallery } from "@/components/charters";
import { PageHeader } from "@/components/ui";
import { charterHome, teamTemplates } from "@/lib/charter-data";
import { BUILT_IN } from "@/lib/charter-templates";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { projectAccess } from "@/lib/session";

export const metadata = { title: "Start from a tour or checklist" };

/** New charter → From a tour or checklist…. */
export default async function CharterGalleryPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ story?: string }> }) {
  const { story } = await searchParams;
  const { project, who } = await projectAccess((await params).key);
  if (!can(who, "case:edit")) notFound();
  const home = await charterHome(project);
  const [team, personas] = await Promise.all([teamTemplates(home.id), db.persona.findMany({ where: { projectId: { in: [project.id, home.id] }, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, emoji: true } })]);
  return (
    <div className="page page-list">
      <PageHeader title="Start from a tour or checklist" subtitle="Click a card to see the charter it makes. Hover a card for what it's for." />
      <TemplateGallery projectId={project.id} projectKey={project.key} templates={[...BUILT_IN, ...team]} personas={personas} canManage={can(who, "shared:manage")} story={story && /^[A-Z][A-Z0-9_]*-\d+$/.test(story) ? story : undefined} />
    </div>
  );
}
