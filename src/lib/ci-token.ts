import { createHash, randomBytes } from "node:crypto";

// CI upload tokens (ver_91): fp_ci_ plus 40 random characters. Only the sha256 is stored.

export const CI_PREFIX = "fp_ci_";

export function newCiToken() {
  const token = CI_PREFIX + randomBytes(30).toString("base64url");
  return { token, hash: ciHash(token), last4: token.slice(-4) };
}

export const ciHash = (token: string) => createHash("sha256").update(token).digest("hex");
