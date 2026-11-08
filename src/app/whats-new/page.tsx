import { ProjectMenu } from "@/components/project-menu";
import { TopBar } from "@/components/top-bar";
import { PageHeader } from "@/components/ui";
import { WhatsNewLine } from "@/components/whats-new";
import { db } from "@/lib/db";
import { mySpelling, requireUser } from "@/lib/session";
import { entriesFor, shortDate } from "@/lib/whats-new";
import { viewerOf } from "@/lib/whats-new-viewer";

export const metadata = { title: "What's new" };

/** Every version's changes, newest first: the same list as the window after sign-in. */
export default async function WhatsNewPage() {
  const user = await requireUser();
  const spelling = await mySpelling();
  const entries = entriesFor(await viewerOf(user));
  // Keep the left menu of the test cycle you were last in, like Your account.
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
        <main className="max-w-2xl min-w-0 flex-1 px-4 pt-6 pb-16 sm:px-6 md:pb-6">
          <PageHeader title="What's new" subtitle="Every Flaw Patrol version, newest first. The how-to steps are in the release notes." />
          {entries.length ? (
            <div className="space-y-4">
              {entries.map((e) => (
                <section key={e.version} className="rounded-lg border border-slate-200 bg-surface px-4 py-3 shadow-sm" aria-label={`Version ${e.version}`}>
                  <h2 className="text-sm font-semibold text-slate-800">
                    Version {e.version} <span className="font-normal text-slate-500">· {shortDate(e.date, spelling)}</span>
                  </h2>
                  <ul className="divide-y divide-slate-100">
                    {e.items.map((i) => (
                      <WhatsNewLine key={i.title} i={i} showMe />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nothing listed yet.</p>
          )}
        </main>
      </div>
    </>
  );
}
