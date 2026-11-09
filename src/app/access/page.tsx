import { notFound, redirect } from "next/navigation";
import { AskToJoin } from "@/components/join-request";
import { LiveRefresh } from "@/components/live-refresh";
import { TopBar } from "@/components/top-bar";
import { Card } from "@/components/ui";
import { andList, safeInside } from "@/lib/link-access";
import { bashGuestOk, resolveLink } from "@/lib/link-access-server";
import { requireUser } from "@/lib/session";

export const metadata = { title: "You're not on this team yet" };

/**
 * Shared links for people outside the team. Someone signed in opened a link to a
 * team they aren't on: say what it is and who the admins are, and offer Ask to join. A link
 * that doesn't point at anything real still says Not found.
 */
export default async function AccessPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const user = await requireUser();
  const to = safeInside((await searchParams).to);
  const link = to ? await resolveLink(to, user) : null;
  if (!to || !link) notFound();
  // Added since (or a bug bash they may join): open the link itself.
  if (link.member) redirect(to);
  if (link.bash && (await bashGuestOk(link.bash.id, user.id))) redirect(to);
  const what = link.bash ? "a bug bash that's over" : link.target.what;
  return (
    <>
      <TopBar user={user} />
      <LiveRefresh url="/api/live/me" />
      <main id="main" tabIndex={-1} className="mx-auto max-w-xl px-4 py-12">
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-slate-900">You&apos;re not on this team yet</h1>
          <p className="mt-2 text-sm text-slate-600">
            {what === "its home page" ? (
              <>
                This link opens <span className="font-medium text-slate-800">{link.team.name}</span>.
              </>
            ) : (
              <>
                This link opens {what} in <span className="font-medium text-slate-800">{link.team.name}</span>.
              </>
            )}{" "}
            {link.admins.length === 1 ? `Its admin is ${link.admins[0]}.` : link.admins.length ? `Its admins are ${andList(link.admins)}.` : ""}
          </p>
          <AskToJoin path={to} admins={link.admins} requestId={link.request?.id ?? null} />
        </Card>
      </main>
    </>
  );
}
