// Liveness check for Kubernetes (and Docker): "is the server process answering?"
// It never touches the database, so a slow or restarting database doesn't make
// Kubernetes kill a healthy pod. Readiness (database reachable) is /api/readyz.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
