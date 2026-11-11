import { ProjectMenu } from "@/components/project-menu";
import { TopBar } from "@/components/top-bar";
import { after } from "next/server";
import { recordVisit } from "@/lib/project-visits";
import { projectAccessOrGuest } from "@/lib/session";
import { cycleSettingsHref, loadUmbrella } from "@/lib/umbrella";
import { ArchivedBanner, UmbrellaArchivedBanner } from "@/components/archive-project";
import { can } from "@/lib/permissions";
import { ViewerNoteFor } from "@/components/viewer-note-server";
import { ToolGate } from "@/components/tools";
import { gateInfo } from "@/lib/tools-data";
import { myPractice } from "@/lib/practice-data";
import { PracticeBanner } from "@/components/practice";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { user, project, role, guest, frame } = await projectAccessOrGuest(key);
  // Someone outside the team in a bug bash: just the bash, without the team's menu.
  if (guest)
    return (
      <>
        <TopBar user={user} />
        <main id="main" tabIndex={-1} className="min-w-0 px-4 pt-6 pb-16 sm:px-6 md:pb-6">{children}</main>
      </>
    );
  // Recent on the Projects page is noted after the page is sent, so nobody waits for it.
  after(() => recordVisit(user.id, project.id));
  // A Viewer is told so, with who can change it (persona audit #6).
  const viewer = role === "VIEWER" && !user.isAdmin;
  // An umbrella's hub project is shown as the umbrella itself, with the umbrella's menu.
  // Which umbrella, and the group's name, came with the project itself: no extra lookups here.
  const { hubOf, group } = frame;
  const umbrella = hubOf ? await loadUmbrella(hubOf, user) : null;
  if (umbrella) {
    return (
      <>
        <TopBar user={user} project={{ key: project.key, name: umbrella.group.name, hub: umbrella.group.id }} />
        <div className="flex">
          <ProjectMenu project={project} user={user} umbrella={umbrella} />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 md:pb-6">
            {umbrella.group.archivedAt && <UmbrellaArchivedBanner groupId={umbrella.group.id} name={umbrella.group.name} canRestore={can(umbrella.who, "umbrella:archive")} />}
            {viewer && <ViewerNoteFor project={project} userId={user.id} />}
            <ToolGate info={await gateInfo(umbrella)}>{children}</ToolGate>
          </main>
        </div>
      </>
    );
  }
  // Archived with its umbrella: the umbrella's banner says how to bring it back.
  const umbrellaArchived = !!group?.hubProjectId && !!group.archivedAt;
  // A test cycle's pages follow its umbrella's tools.
  const parent = group?.hubProjectId ? await loadUmbrella(group.id, user) : null;
  // A practice run (ver_217): the banner on every page says it's yours alone and how to remove it.
  const practice = project.practiceFor ? await myPractice(user.id) : null;
  return (
    <>
      <TopBar user={user} project={{ key: project.key, name: project.name, group: group && { id: group.id, name: group.name } }} />
      <div className="flex">
        <ProjectMenu project={project} user={user} />
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 md:pb-6">
          {umbrellaArchived ? (
            <UmbrellaArchivedBanner groupId={group!.id} name={group!.name} canRestore={role === "ADMIN"} />
          ) : (
            project.archivedAt && <ArchivedBanner settingsHref={await cycleSettingsHref(project, user, "archive")} canRestore={role === "ADMIN"} />
          )}
          {viewer && <ViewerNoteFor project={project} userId={user.id} />}
          {practice && <PracticeBanner tested={practice.tested} total={practice.total} />}
          {parent ? <ToolGate info={await gateInfo(parent)}>{children}</ToolGate> : children}
        </main>
      </div>
    </>
  );
}
