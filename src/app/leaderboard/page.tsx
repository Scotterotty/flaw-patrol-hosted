import { Avatar } from "@/components/avatar";
import { TopBar } from "@/components/top-bar";
import { Card, cx, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { badgeOf, levelFor, totalXp } from "@/lib/game";
import { requireUser } from "@/lib/session";
import { gameStats } from "@/lib/xp";

export const metadata = { title: "Bug of War" };

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Bug of War, the leaderboard that doesn't exist. Nothing links here: it opens after five
 * quick clicks on "leaderboard" in the mini game's description. Only people
 * who play the mini game are listed.
 */
export default async function LeaderboardPage() {
  const user = await requireUser();
  const players = await db.user.findMany({
    where: { gameEnabled: true },
    select: { id: true, name: true, email: true, avatarAt: true, gameEnabled: true, gameTitle: true, gameFrame: true },
  });
  const rows = (
    await Promise.all(
      players.map(async (p) => {
        const stats = await gameStats(p.id);
        const xp = totalXp(stats);
        return { ...p, xp, level: levelFor(xp).level, streak: stats.bestStreak, badge: badgeOf(p) };
      }),
    )
  ).sort((a, b) => b.xp - a.xp || (a.name ?? a.email).localeCompare(b.name ?? b.email));

  return (
    <>
      <TopBar user={user} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-8">
        <PageHeader title="Bug of War 🤫" subtitle="There's no leaderboard. You didn't see this. Only mini game players are listed." />
        {!user.gameEnabled && (
          <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Join the mini game in Your profile to join the Bug of War.</p>
        )}
        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Nobody is playing yet. Suspiciously quiet.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <li key={r.id} className={cx("flex items-center gap-3 px-4 py-3", r.id === user.id && "bg-accent-50")}>
                  <span className="w-8 shrink-0 text-center text-lg tabular-nums text-slate-500" aria-label={`Rank ${i + 1}`}>
                    {MEDALS[i] ?? i + 1}
                  </span>
                  <Avatar person={{ ...r, ...r.badge }} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {r.name ?? r.email}
                      {r.id === user.id && <span className="text-slate-500"> (you)</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      Level {r.level}
                      {r.badge.title && ` · ${r.badge.title}`}
                      {r.streak > 1 && ` · best streak ${r.streak} days`}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{r.xp.toLocaleString()} XP</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </main>
    </>
  );
}
