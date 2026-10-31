import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { liveRowsFor } from "@/lib/live-rows-data";
import { currentUser } from "@/lib/session";

// A short fingerprint of a run's assignments, statuses and step progress. Open run pages poll
// it and refresh when it changes, so everyone sees who's on what. Pass ?rows=<fingerprint you
// have> to also get every row's status and step pips when it's changed (ver_112), so the page
// can update its list straight away instead of waiting for a reload.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const have = new URL(req.url).searchParams.get("rows");
  // Read before the rows are, so a page drawn after this check always counts as newer.
  const at = Date.now();
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
  const v = hash.digest("base64url");
  // When the run last changed (a result or a step), so a page drawn after it knows it's current.
  const latest = Math.max(0, ...run.entries.map((e) => Math.max(e.lastTestedAt?.getTime() ?? 0, e.draftAt?.getTime() ?? 0)));
  const rows = have && have !== v ? await liveRowsFor(id, user.id) : undefined;
  return Response.json(rows ? { v, latest, at, rows } : { v, latest }, { headers: { "Cache-Control": "no-store" } });
}
