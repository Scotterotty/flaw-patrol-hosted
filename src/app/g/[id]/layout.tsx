import { TopBar } from "@/components/top-bar";
import { UmbrellaNav } from "@/components/umbrella-nav";
import { loadUmbrella, navOf } from "@/lib/umbrella";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { UmbrellaArchivedBanner } from "@/components/archive-project";
import { glossaryMenu } from "@/lib/glossary-data";

/** Umbrellas get their own left menu on every page; plain project groups draw their own page. */
export default async function GroupLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const u = await loadUmbrella(id, user);
  if (!u) return children;
  return (
    <>
      <TopBar user={user} project={{ key: u.hub.key, name: u.group.name, hub: u.group.id }} />
      <div className="flex">
        <UmbrellaNav u={navOf(u)} glossary={await glossaryMenu(user.id)} />
        <main className="min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 md:pb-6">
          {u.group.archivedAt && <UmbrellaArchivedBanner groupId={u.group.id} name={u.group.name} canRestore={can(u.who, "umbrella:archive")} />}
          {children}
        </main>
      </div>
    </>
  );
}
