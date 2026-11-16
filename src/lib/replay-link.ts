import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Links to one replay file for the trace viewer on its separate address (replay-origin.ts).
// Nobody is signed in there, so the link itself is the permission: it names one file, is
// signed with a key from AUTH_SECRET, and stops working after a few hours.

export const REPLAY_LINK_HOURS = 4;

function mac(body: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", `replay-link:${secret}`).update(body).digest("base64url");
}

/** A signed token for attachment `fileId`. */
export function replayToken(fileId: string, now = Date.now()): string {
  const body = `${fileId}.${Math.floor(now / 1000) + REPLAY_LINK_HOURS * 3600}`;
  return `${body}.${mac(body)}`;
}

/** The attachment id a token names, or null when it's altered or out of date. */
export function replayTokenFile(token: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [fileId, exp, sig] = parts;
  const want = Buffer.from(mac(`${fileId}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now) return null;
  return fileId;
}
