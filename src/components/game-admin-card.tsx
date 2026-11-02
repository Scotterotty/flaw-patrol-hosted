import { levelFor, totalXp } from "@/lib/game";
import { db } from "@/lib/db";
import { gameStatsMany } from "@/lib/xp";
import { GameAdmin } from "./game-admin";

/** Workspace admins only: everyone's XP, resets, and going live. */
export async function GameAdminCard() {
  const [users, workspace] = await Promise.all([
    db.user.findMany({
      select: { id: true, name: true, email: true, gameEnabled: true, earlyAdopter: true, lastLoginAt: true, xpSince: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    db.workspace.findUnique({ where: { id: 1 } }),
  ]);
  // Everyone counted together, sharing run and quest lookups.
  const stats = await gameStatsMany(users.map((u) => u.id));
  const people = await Promise.all(
    users.map(async (u) => {
      const xp = totalXp(stats.get(u.id)!);
      return {
        id: u.id,
        name: u.name ?? u.email,
        playing: u.gameEnabled,
        xp,
        level: levelFor(xp).level,
        early: u.earlyAdopter || (!workspace?.launchedAt && !!u.lastLoginAt),
        resetAt: u.xpSince?.toISOString().slice(0, 10) ?? null,
      };
    }),
  );
  return <GameAdmin people={people} launchedAt={workspace?.launchedAt?.toISOString().slice(0, 10) ?? null} />;
}
