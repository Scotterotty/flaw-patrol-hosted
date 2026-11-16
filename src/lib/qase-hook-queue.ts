// Qase webhooks arrive for every saved result, so a busy run can send hundreds a minute.
// Backend review: "the Qase webhook has no rate limit". Each umbrella runs at most one sync at
// a time; webhooks that arrive meanwhile ask for one more sync after it, at least GAP_MS
// later, so the last results still come in but a flood costs only a few syncs.

export const QASE_HOOK_GAP_MS = 15_000;

const queued = new Map<string, { again: boolean }>();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `sync` for `groupId` now, or once more after the current one when one is going.
 * Returns the promise of the whole round (for after()), or null when it joined one already going.
 */
export function queueQaseSync(groupId: string, sync: () => Promise<void>, gapMs = QASE_HOOK_GAP_MS): Promise<void> | null {
  const going = queued.get(groupId);
  if (going) {
    going.again = true;
    return null;
  }
  const entry = { again: false };
  queued.set(groupId, entry);
  return (async () => {
    try {
      do {
        entry.again = false;
        await sync().catch(() => {});
        await wait(gapMs);
      } while (entry.again);
    } finally {
      queued.delete(groupId);
    }
  })();
}
