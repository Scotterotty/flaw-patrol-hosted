// Hosted build (backend review: "Upload DoS"). A results upload can be 200 MB and is held in
// memory while it's read and unpacked, so this server takes only a few at once, one at a
// time per person (or CI token), and a limited number per hour. Counted in this server's
// memory, which is what the limit protects; the hosted setup runs one copy of the app
// (deploy/kubernetes/README.md, "Why one replica").
//
// UPLOAD_CONCURRENCY sets how many big uploads the server takes at once (default 3).

const HOUR = 60 * 60 * 1000;
export const UPLOADS_PER_HOUR = 30;

const running = new Set<string>();
let total = 0;
const recent = new Map<string, number[]>();

export function uploadSlots(env: string | undefined = process.env.UPLOAD_CONCURRENCY): number {
  const n = Number(env);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

export type Gate = { ok: true; done: () => void } | { ok: false; status: 429 | 503; error: string };

/**
 * Asks to start a big upload for `who` (a person's or CI token's id). Call `done()` when the
 * upload has been read and unpacked, whether it worked or not.
 */
export function startUpload(who: string, now = Date.now(), slots = uploadSlots()): Gate {
  if (running.has(who)) return { ok: false, status: 429, error: "Your last upload is still going. Wait for it to finish, then try again." };
  const times = (recent.get(who) ?? []).filter((t) => now - t < HOUR);
  if (times.length >= UPLOADS_PER_HOUR) {
    const wait = Math.max(1, Math.ceil((times[0] + HOUR - now) / 60_000));
    return { ok: false, status: 429, error: `That's ${UPLOADS_PER_HOUR} uploads in the last hour. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` };
  }
  if (total >= slots) return { ok: false, status: 503, error: "Flaw Patrol is busy with other uploads right now. Try again in a minute." };
  running.add(who);
  total++;
  times.push(now);
  recent.set(who, times);
  let finished = false;
  return {
    ok: true,
    done: () => {
      if (finished) return;
      finished = true;
      running.delete(who);
      total--;
    },
  };
}

/** For tests: forget everything. */
export function resetUploadGate() {
  running.clear();
  total = 0;
  recent.clear();
}
