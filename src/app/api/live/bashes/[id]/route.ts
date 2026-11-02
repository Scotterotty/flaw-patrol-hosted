import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { bashGuestOk } from "@/lib/link-access-server";
import { currentUser } from "@/lib/session";
import { bashTick } from "@/server/bashes";

// A bug bash's fingerprint: who's in where, and every line logged. The board and
// the bash runner poll it; each look also sends the 10-minute warning when it's due.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const bash = await db.bugBash.findUnique({
    where: { id },
    select: {
      projectId: true,
      endedAt: true,
      wrappedAt: true,
      people: { select: { userId: true, areaId: true }, orderBy: { userId: "asc" } },
      items: { select: { id: true, review: true, severity: true, plusOnes: true, mergedIntoId: true, defectId: true }, orderBy: { id: "asc" } },
    },
  });
  if (!bash) return new Response(null, { status: 404 });
  // People outside the team who may be in this bash see it too.
  if (!user.isAdmin && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: bash.projectId, userId: user.id } } })) && !(await bashGuestOk(id, user.id))) return new Response(null, { status: 404 });
  await bashTick(id).catch(() => {});
  const hash = createHash("sha1").update(`${bash.endedAt?.getTime() ?? ""}|${bash.wrappedAt?.getTime() ?? ""}`);
  for (const p of bash.people) hash.update(`|${p.userId}:${p.areaId}`);
  for (const i of bash.items) hash.update(`|${i.id}:${i.review}:${i.severity}:${JSON.stringify(i.plusOnes)}:${i.mergedIntoId ?? ""}:${i.defectId ?? ""}`);
  return Response.json({ v: hash.digest("base64url") }, { headers: { "Cache-Control": "no-store" } });
}
