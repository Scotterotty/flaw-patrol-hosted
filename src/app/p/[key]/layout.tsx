import { ProjectMenu } from "@/components/project-menu";
import { TopBar } from "@/components/top-bar";
import { db } from "@/lib/db";
import { recordVisit } from "@/lib/project-visits";
import { projectAccess } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";
import { ArchivedBanner, UmbrellaArchivedBanner } from "@/components/archive-project";
import { can } from "@/lib/permissions";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { user, project, role } = await projectAccess(key);
  await recordVisit(user.id, project.id);
  // An umbrella's hub project is shown as the umbrella itself, with the umbrella's menu.
  const hubOf = await db.projectGroup.findUnique({ where: { hubProjectId: project.id }, select: { id: true } });
  const umbrella = hubOf ? await loadUmbrella(hubOf.id, user) : null;
  if (umbrella) {
    return (
      <>
        <TopBar user={user} project={{ key: project.key, name: umbrella.group.name, hub: umbrella.group.id }} />
        <div className="flex">
          <ProjectMenu project={project} user={user} umbrella={umbrella} />
          <main className="min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 md:pb-6">
            {umbrella.group.archivedAt && <UmbrellaArchivedBanner groupId={umbrella.group.id} name={umbrella.group.name} canRestore={can(umbrella.who, "umbrella:archive")} />}
            {children}
          </main>
        </div>
      </>
    );
  }
  const group = project.groupId ? await db.projectGroup.findUnique({ where: { id: project.groupId }, select: { id: true, name: true, archivedAt: true, hubProjectId: true } }) : null;
  // Archived with its umbrella: the umbrella's banner says how to bring it back.
  const umbrellaArchived = !!group?.hubProjectId && !!group.archivedAt;
  return (
    <>
      <TopBar user={user} project={{ key: project.key, name: project.name, group: group && { id: group.id, name: group.name } }} />
      <div className="flex">
        <ProjectMenu project={project} user={user} />
        <main className="min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 md:pb-6">
          {umbrellaArchived ? (
            <UmbrellaArchivedBanner groupId={group!.id} name={group!.name} canRestore={role === "ADMIN"} />
          ) : (
            project.archivedAt && <ArchivedBanner projectKey={project.key} canRestore={role === "ADMIN"} />
          )}
          {children}
        </main>
      </div>
    </>
  );
}
