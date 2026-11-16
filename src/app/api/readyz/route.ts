import { db } from "@/lib/db";

// Readiness check for Kubernetes (and Docker): "can this pod serve people right now?"
// Runs SELECT 1 against the database with a short time limit. Answers 503 when the
// database can't be reached, so traffic waits instead of hitting error pages.
// The body never includes the error text, which could name the database host.
export const dynamic = "force-dynamic";

const LIMIT_MS = 3000;

export async function GET() {
  const headers = { "cache-control": "no-store" };
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), LIMIT_MS)),
    ]);
    return Response.json({ ok: true, database: "ok" }, { headers });
  } catch (e) {
    console.error("[readyz] database check failed:", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, database: "unreachable" }, { status: 503, headers });
  }
}
