import Link from "next/link";
import { signOut } from "@/auth";
import { db } from "@/lib/db";
import { badgeOf } from "@/lib/game";
import { PROVIDER_NAME, type CompanyProvider } from "@/lib/sign-in-config";
import { currentUser } from "@/lib/session";
import { AccountMenu } from "./account-menu";
import { FeedbackButton } from "./feedback-button";
import { Avatar } from "./avatar";
import { Breadcrumbs } from "./breadcrumbs";
import { GlobalSearch } from "./global-search";
import { Logo } from "./logo";
import { RadioPlayer } from "./radio-player";
import { LiveBashPill } from "./bash";
import { charterHome } from "@/lib/charter-data";
import { liveBashOf } from "@/lib/umbrella";
import { joinRequestsFor } from "@/lib/link-access-server";

export async function TopBar({ user, project }: { user: { id: string; name: string | null; email: string; avatarAt: Date | null; gameEnabled?: boolean; gameTitle?: string | null; gameFrame?: string | null; isAdmin?: boolean }; project?: { key: string; name: string; group?: { id: string; name: string } | null; hub?: string } }) {
  const badge = badgeOf(user);
  // Ask to join: a dot on admins' avatars while someone is waiting.
  // The join dot, the sign-in secret reminder and the live bug bash pill are asked for together.
  const [joins, secret, live, me, feedback] = await Promise.all([
    joinRequestsFor({ id: user.id, isAdmin: !!user.isAdmin }).catch(() => ({ count: 0, href: null })),
    secretSoon(!!user.isAdmin),
    project ? liveBashFor(project.key, user.id) : null,
    currentUser(),
    feedbackCounts(user.id, !!user.isAdmin),
  ]);
  return (
    <header className="fp-bar sticky top-0 z-40 border-b border-slate-200 bg-surface/95 backdrop-blur">
      <div className="flex h-12 items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900" data-howto="top-home">
          <Logo />
          <span className="font-heading text-lg max-sm:sr-only">Flaw Patrol</span>
        </Link>
        <div className="flex min-w-0 flex-1 items-center">
          <Breadcrumbs project={project && { key: project.key, name: project.name, group: project.group, hub: project.hub }} />
        </div>
        {live && (
          <span className="hidden shrink-0 md:inline">
            <LiveBashPill href={live.href} endsAt={live.endsAt} joined={live.joined} />
          </span>
        )}
        <GlobalSearch scope={project?.hub ? { id: project.hub, name: project.name } : (project?.group ?? null)} />
        {/* The radio sits next to your name, for people who turned it on. What plays, and its Spotify panel, live in the root layout so they survive page changes. */}
        {me?.radioEnabled && <RadioPlayer />}
        {secret && <SecretBanner soon={secret} />}
        {/* Feedback sits in the bar, never floating over the page (Scott, ver_145). */}
        <FeedbackButton unseen={feedback.unseen} waiting={feedback.waiting} />
        <AccountMenu
          label={`${user.email} · your account`}
          admin={!!user.isAdmin}
          joins={joins.count && joins.href ? { count: joins.count, href: joins.href } : null}
          signOut={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <span className="relative inline-flex">
            <Avatar person={{ ...user, ...badge }} size={26} />
            {joins.count > 0 && (
              <span data-testid="join-dot" className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-surface">
                <span className="sr-only">{joins.count === 1 ? "1 person is asking to join" : `${joins.count} people are asking to join`}</span>
              </span>
            )}
          </span>
          <span className="hidden truncate sm:inline">
            {user.name ?? user.email}
            {badge.title && <span className="text-slate-400"> · {badge.title}</span>}
          </span>
        </AccountMenu>
      </div>
    </header>
  );
}

// Replies to your feedback you haven't opened, and for workspace admins, feedback nobody has looked at yet.
async function feedbackCounts(userId: string, admin: boolean) {
  const [unseen, waiting] = await Promise.all([
    db.feedback.count({ where: { userId, unseen: true } }).catch(() => 0),
    admin ? db.feedback.count({ where: { status: "new" } }).catch(() => 0) : 0,
  ]);
  return { unseen, waiting };
}

// Workspace admins get a reminder 14 days before a company sign-in's secret expires.
async function secretSoon(admin: boolean) {
  if (!admin) return null;
  const soon = await db.signInProvider
    .findMany({ where: { secretExpires: { lte: new Date(Date.now() + 14 * 86_400_000) } }, select: { id: true, label: true, secretExpires: true } })
    .catch(() => []);
  return soon[0] ?? null;
}

function SecretBanner({ soon: p }: { soon: { id: string; label: string; secretExpires: Date | null } }) {
  const days = Math.ceil((p.secretExpires!.getTime() - Date.now()) / 86_400_000);
  const name = p.id === "oidc" ? p.label || PROVIDER_NAME.oidc : PROVIDER_NAME[p.id as CompanyProvider];
  return (
    <Link href="/workspace#sign-in" className="hidden shrink-0 rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100 md:inline">
      {days < 0 ? `${name} sign-in secret expired` : `${name} sign-in secret expires in ${days} day${days === 1 ? "" : "s"}`}
    </Link>
  );
}

// A bug bash on now in this umbrella: "🐞 Bug bash live · Join" on every page in it.
async function liveBashFor(projectKey: string, userId: string) {
  const p = await db.project.findUnique({ where: { key: projectKey }, select: { id: true, key: true, groupId: true } });
  if (!p) return null;
  const home = await charterHome(p);
  const live = await liveBashOf(home.id);
  if (!live) return null;
  // Already in it: the pill says "Back to it" and opens your area, not the join cards.
  const joined = !!(await db.bashPerson.findUnique({ where: { bashId_userId: { bashId: live.id, userId } }, select: { userId: true } }));
  return { href: joined ? `/p/${home.key}/bashes/${live.id}/explore` : `/p/${home.key}/bashes/${live.id}?join=1`, endsAt: live.endsAt, joined };
}
