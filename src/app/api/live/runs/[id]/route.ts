import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

// A short fingerprint of a run's assignments, statuses and step progress. Open run pages poll
// it and refresh when it changes, so everyone sees who's on what.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const run = await db.testRun.findUnique({
    where: { id },
    select: {
      projectId: true,
      state: true,
      name: true,
      entries: { select: { id: true, assigneeId: true, status: true, lastTestedAt: true, draftAt: true }, orderBy: { id: "asc" } },
    },
  });
  if (!run) return new Response(null, { status: 404 });
  if (!user.isAdmin && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: run.projectId, userId: user.id } } }))) {
    return new Response(null, { status: 404 });
  }
  const hash = createHash("sha1").update(`${run.state}|${run.name}`);
  for (const e of run.entries) hash.update(`|${e.id}:${e.assigneeId ?? ""}:${e.status}:${e.lastTestedAt?.getTime() ?? ""}:${e.draftAt?.getTime() ?? ""}`);
  return Response.json({ v: hash.digest("base64url") }, { headers: { "Cache-Control": "no-store" } });
}
