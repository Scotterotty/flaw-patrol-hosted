import { ProfileSettings } from "@/components/profile-settings";
import { ProjectMenu } from "@/components/project-menu";
import { TopBar } from "@/components/top-bar";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await requireUser();
  // Keep the left menu of the project you were last in, so you can see font and size changes on it and go straight back.
  const last = await db.projectPin.findFirst({
    where: { userId: user.id, visitedAt: { not: null }, project: { archivedAt: null, members: { some: { userId: user.id } } } },
    orderBy: { visitedAt: "desc" },
    select: { project: { select: { id: true, key: true, name: true, groupId: true, platform: true } } },
  });
  return (
    <>
      <TopBar user={user} />
      <div className="flex">
        {last && <ProjectMenu project={last.project} user={user} />}
        <main className="mx-auto max-w-xl min-w-0 flex-1 px-4 py-8 pb-16 md:pb-8">
          <PageHeader title="Your account" subtitle={user.email} />
          {/* Every card folds to one line, so the section tabs went: Open all / Close all instead. */}
          <ProfileSettings user={user} />
        </main>
      </div>
    </>
  );
}
