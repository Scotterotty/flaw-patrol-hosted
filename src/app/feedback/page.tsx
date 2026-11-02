import { FeedbackInbox, type FeedbackRow } from "@/components/feedback-inbox";
import { ProjectMenu } from "@/components/project-menu";
import { TopBar } from "@/components/top-bar";
import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { areaOf } from "@/lib/feedback";
import { requireUser } from "@/lib/session";
import { viewerZone } from "@/lib/zone-server";

export const metadata = { title: "Feedback" };

/**
 * Feedback about Flaw Patrol (ver_145). Everyone sees what they sent; workspace admins also see
 * everyone's, reply, set a status and turn it into a bug. It lists feedback, never people:
 * no counts or rankings by who sent it.
 */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const everyone = user.isAdmin && sp.view !== "yours";
  const zone = await viewerZone();
  const [rows, last, projects] = await Promise.all([
    db.feedback.findMany({
      where: everyone ? {} : { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        kind: true,
        message: true,
        place: true,
        path: true,
        appVersion: true,
        browser: true,
        userId: true,
        userName: true,
        status: true,
        unseen: true,
        bugHref: true,
        createdAt: true,
        shots: { select: { id: true }, orderBy: { createdAt: "asc" } },
        replies: { select: { id: true, authorName: true, authorId: true, text: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    db.projectPin.findFirst({
      where: { userId: user.id, visitedAt: { not: null }, project: { archivedAt: null, members: { some: { userId: user.id } } } },
      orderBy: { visitedAt: "desc" },
      select: { project: { select: { id: true, key: true, name: true, groupId: true, platform: true } } },
    }),
    // Turn into a bug: the test cycles a workspace admin can file it on.
    user.isAdmin ? db.project.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, key: true, name: true }, take: 500 }) : [],
  ]);
  const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone, timeZoneName: "short" });
  const items: FeedbackRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    place: r.place,
    path: r.path,
    area: areaOf(r.path),
    appVersion: r.appVersion,
    browser: r.browser,
    from: r.userId === user.id ? "You" : r.userName || "Sent without a name",
    firstName: (r.userName || "").split(" ")[0],
    mine: r.userId === user.id,
    anonymous: !r.userId,
    status: r.status,
    unseen: r.unseen && r.userId === user.id,
    bugHref: r.bugHref,
    when: when.format(r.createdAt),
    shots: r.shots.map((s) => s.id),
    replies: r.replies.map((p) => ({ id: p.id, who: p.authorId === user.id ? "You" : p.authorName, text: p.text, when: when.format(p.createdAt) })),
  }));
  return (
    <>
      <TopBar user={user} />
      <div className="flex">
        {last && <ProjectMenu project={last.project} user={user} />}
        <main className="mx-auto max-w-6xl min-w-0 flex-1 px-4 py-8 pb-16 md:pb-8">
          <PageHeader
            title="Feedback"
            subtitle={user.isAdmin ? "What people think of Flaw Patrol. Reply, set where it's at, or turn it into a bug." : "What you've told us about Flaw Patrol, and any replies. Send more with Feedback at the top of any page."}
          />
          <FeedbackInbox items={items} admin={user.isAdmin} everyone={everyone} projects={projects} />
        </main>
      </div>
    </>
  );
}
