import { TopBar } from "@/components/top-bar";
import { UmbrellaNav } from "@/components/umbrella-nav";
import { loadUmbrella, navOf } from "@/lib/umbrella";
import { notOnTeam, requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { UmbrellaArchivedBanner } from "@/components/archive-project";
import { glossaryMenu } from "@/lib/glossary-data";
import { ViewerNoteFor } from "@/components/viewer-note-server";

/** Umbrellas get their own left menu on every page; plain project groups draw their own page. */
export default async function GroupLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  // The umbrella and the glossary menu are asked for together (ver_120).
  const [u, glossary] = await Promise.all([loadUmbrella(id, user), glossaryMenu(user.id)]);
  if (!u) {
    // An umbrella they aren't on (ver_115): say what it is and offer Ask to join.
    const hub = await db.projectGroup.findUnique({ where: { id }, select: { hubProjectId: true } });
    if (hub?.hubProjectId) return notOnTeam(`/g/${id}`);
    return children;
  }
  return (
    <>
      <TopBar user={user} project={{ key: u.hub.key, name: u.group.name, hub: u.group.id }} />
      <div className="flex">
        <UmbrellaNav u={navOf(u)} glossary={glossary} />
        <main className="min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 md:pb-6">
          {u.group.archivedAt && <UmbrellaArchivedBanner groupId={u.group.id} name={u.group.name} canRestore={can(u.who, "umbrella:archive")} />}
          {u.who.role === "VIEWER" && !user.isAdmin && <ViewerNoteFor project={{ id: u.hub.id, key: u.hub.key, name: u.group.name, groupId: null, keepMembersSeparate: false }} userId={user.id} />}
          {children}
        </main>
      </div>
    </>
  );
}
