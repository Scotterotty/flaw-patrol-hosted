import { FRAMES, levelFor, TITLES, totalXp, unlockDetail, XP_RULES, type XpRule } from "@/lib/game";
import { gameStats } from "@/lib/xp";
import { db } from "@/lib/db";
import { GamePanel, type GameOption } from "./game-panel";

type Player = {
  id: string;
  name: string | null;
  email: string;
  avatarAt: Date | null;
  gameEnabled: boolean;
  gameTitle: string | null;
  gameFrame: string | null;
  questMap?: boolean;
};

/** The mini game: off until you join, then your level, how you earned XP, and what you've unlocked. */
export async function GameCard({ user }: { user: Player }) {
  if (!user.gameEnabled) return <GamePanel enabled={false} person={user} title={null} frame={null} />;

  const stats = await gameStats(user.id);
  // Pawn gear is picked on a Quest map; send people to the one in the project they used last.
  const lastProject = user.questMap
    ? await db.projectPin.findFirst({ where: { userId: user.id, visitedAt: { not: null }, project: { hubOf: null, archivedAt: null } }, orderBy: { visitedAt: "desc" }, select: { project: { select: { key: true } } } })
    : null;
  const xp = totalXp(stats);
  const { level, from, to } = levelFor(xp);
  const options = <
    T extends {
      id: string;
      label: string;
      unlock: Parameters<typeof unlockDetail>[0];
    },
  >(
    list: readonly T[],
  ): GameOption[] =>
    list
      .map((o) => ({ o, d: unlockDetail(o.unlock, stats, level, xp) }))
      // Early Adopter stays a surprise: it only shows once you have it.
      .filter(({ o, d }) => d.unlocked || !("stat" in o.unlock && o.unlock.stat === "earlyAdopter"))
      .map(({ o, d }) => ({ id: o.id, label: o.label, ...d }));

  return (
    <GamePanel
      enabled
      questMap={user.questMap}
      pawnHref={lastProject ? `/p/${lastProject.project.key}/quests?gear=1#your-pawn` : null}
      person={user}
      title={user.gameTitle}
      frame={user.gameFrame}
      progress={{
        xp,
        level,
        from,
        to,
        currentStreak: stats.currentStreak,
        breakdown: (Object.keys(XP_RULES) as XpRule[]).map((k) => ({
          key: k,
          label: XP_RULES[k].label,
          hint: XP_RULES[k].hint,
          each: XP_RULES[k].xp,
          count: stats[k],
        })),
        titles: options(TITLES),
        frames: options(FRAMES),
      }}
    />
  );
}
