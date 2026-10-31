import "server-only";
import { db as defaultDb } from "@/lib/db";

/**
 * A small per-token limit so a looping pipeline can't flood the database: 20 uploads
 * per token per minute. Hits are rows in CiTokenHit rather than memory, so the count
 * survives a restart and every server instance sees the same number.
 */
export const CI_WINDOW_MS = 60_000;
export const CI_MAX_PER_WINDOW = 20;

type HitStore = Pick<typeof defaultDb, "ciTokenHit">;

export async function ciRateLimited(tokenId: string, now = new Date(), db: HitStore = defaultDb) {
  const since = new Date(now.getTime() - CI_WINDOW_MS);
  // Old hits are cleared as we go; they're only needed for one window.
  await db.ciTokenHit.deleteMany({ where: { tokenId, at: { lt: since } } });
  // Record first, then count: two uploads at the same moment both see each other,
  // so the limit can't be slipped past by sending in parallel.
  const hit = await db.ciTokenHit.create({ data: { tokenId, at: now }, select: { id: true } });
  const count = await db.ciTokenHit.count({ where: { tokenId, at: { gte: since } } });
  if (count <= CI_MAX_PER_WINDOW) return false;
  // A refused upload doesn't count toward the next minute.
  await db.ciTokenHit.delete({ where: { id: hit.id } }).catch(() => {});
  return true;
}
