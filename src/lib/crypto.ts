import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Secrets at rest (Jira, GitHub, Qase, TeamCity, Sentry tokens, Slack links, sign-in and mail
// passwords) are sealed with AES-256-GCM.
//
// Hosted build (backend review: "Encryption key tied to auth"): with ENCRYPTION_KEY set, new
// values are sealed with a key from ENCRYPTION_KEY ("v2."), so changing AUTH_SECRET only signs
// people out and no longer breaks integrations. Older values ("v1.") were sealed with
// AUTH_SECRET; they still open, and the server re-seals them with ENCRYPTION_KEY when it starts
// (src/lib/reseal.ts). Without ENCRYPTION_KEY everything works as before (v1, AUTH_SECRET).

function derive(label: string, secret: string) {
  return createHash("sha256").update(`${label}:${secret}`).digest();
}

function authKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return derive("secret-box", secret);
}

function encryptionKey() {
  const secret = process.env.ENCRYPTION_KEY?.trim();
  return secret ? derive("secret-box-v2", secret) : null;
}

/** Whether new values are sealed with ENCRYPTION_KEY. */
export const hasEncryptionKey = () => encryptionKey() !== null;

export function seal(plain: string): string {
  const v2 = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", v2 ?? authKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [v2 ? "v2" : "v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  let key: Buffer;
  if (v === "v1") key = authKey();
  else if (v === "v2") {
    const k = encryptionKey();
    if (!k) throw new Error("This value was sealed with ENCRYPTION_KEY, which isn't set");
    key = k;
  } else throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** Whether this copy's keys can open a sealed value. */
export function canOpen(sealed: string) {
  try {
    open(sealed);
    return true;
  } catch {
    return false;
  }
}

/**
 * The same secret sealed with ENCRYPTION_KEY, for a value still sealed with AUTH_SECRET.
 * Null when there's nothing to do (no ENCRYPTION_KEY, already v2, or it can't be opened here).
 */
export function resealed(sealed: string): string | null {
  if (!hasEncryptionKey() || !sealed.startsWith("v1.")) return null;
  try {
    return seal(open(sealed));
  } catch {
    return null;
  }
}
