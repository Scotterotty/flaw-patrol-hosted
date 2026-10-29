import { createHash, randomBytes } from "node:crypto";

// CI upload tokens (ver_91): fp_ci_ plus 40 random characters. Only the sha256 is stored.

export const CI_PREFIX = "fp_ci_";

export function newCiToken() {
  const token = CI_PREFIX + randomBytes(30).toString("base64url");
  return { token, hash: ciHash(token), last4: token.slice(-4) };
}

export const ciHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A small per-token limit so a looping pipeline can't flood the database. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();
export function ciRateLimited(tokenId: string, now = Date.now()) {
  const recent = (hits.get(tokenId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(tokenId, recent);
    return true;
  }
  recent.push(now);
  hits.set(tokenId, recent);
  return false;
}
