import { FRAMES, levelFor, TITLES, totalXp, unlockDetail, XP_RULES, type GameStats, type XpRule } from "@/lib/game";
import { crownsFor, toTake } from "@/lib/crowns";
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
  seasonalMaps?: boolean;
};

/** The mini game: off until you join, then your level, how you earned XP, and what you've unlocked. */
export async function GameCard({ user, stats: given }: { user: Player; stats?: GameStats | null }) {
  if (!user.gameEnabled) return <GamePanel enabled={false} person={user} title={null} frame={null} />;

  const stats = given ?? (await gameStats(user.id));
  // Crowns (ver_96): counted fresh for every umbrella you're in.
  const crowns = await crownsFor(user.id);
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
      seasonalMaps={user.seasonalMaps ?? true}
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
        crowns: crowns.map((c) => ({
          id: c.titleId,
          label: c.label,
          umbrella: c.umbrella,
          mine: c.holderId === user.id,
          holder: c.holderName,
          since: c.since.toISOString(),
          you: c.mine,
          top: c.top,
          nextBest: c.nextBest,
          unit: c.unit,
          need: c.need,
          toTake: toTake(c),
          verb: c.verb,
        })),
      }}
    />
  );
}
