import { db } from "@/lib/db";
import { parseDraft } from "@/lib/run-draft";
import { currentUser } from "@/lib/session";

// One case's autosaved step results and who made the last change. The runner
// polls it so step results others mark show up while you have the case open.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const entry = await db.runEntry.findUnique({
    where: { id },
    select: {
      status: true,
      draft: true,
      draftAt: true,
      draftByName: true,
      draftById: true,
      run: { select: { projectId: true } },
      results: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, testerName: true, testerId: true, createdAt: true } },
    },
  });
  if (!entry) return new Response(null, { status: 404 });
  if (!user.isAdmin && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: entry.run.projectId, userId: user.id } } }))) {
    return new Response(null, { status: 404 });
  }
  const last = entry.results[0];
  return Response.json(
    {
      status: entry.status,
      draft: parseDraft(entry.draft),
      draftAt: entry.draftAt?.toISOString() ?? null,
      draftBy: entry.draftAt ? { name: entry.draftByName, mine: entry.draftById ? entry.draftById === user.id : entry.draftByName === (user.name ?? user.email) } : null,
      lastResult: last ? { id: last.id, status: last.status, testerName: last.testerName, mine: last.testerId === user.id, at: last.createdAt.toISOString() } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
