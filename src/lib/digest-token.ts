import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DigestKind } from "./digest-settings";

// The Stop link in a digest email: who and which kind, signed with AUTH_SECRET so
// nobody can stop someone else's emails by changing the link. No sign-in needed to use it.

const sign = (body: string) => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", `digest-stop:${secret}`).update(body).digest("base64url");
};

export function stopToken(email: string, kind: DigestKind) {
  const body = Buffer.from(JSON.stringify({ e: email.toLowerCase(), k: kind })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readStopToken(token: string): { email: string; kind: DigestKind } | null {
  const [body, mac] = String(token ?? "").split(".");
  if (!body || !mac || body.length > 600) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { e?: unknown; k?: unknown };
    if (typeof v.e !== "string" || !["run", "bash", "rc"].includes(v.k as string)) return null;
    return { email: v.e, kind: v.k as DigestKind };
  } catch {
    return null;
  }
}
