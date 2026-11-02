import { bashFinds } from "@/lib/bash-live";
import { db } from "@/lib/db";
import { bashGuestOk } from "@/lib/link-access-server";
import { currentUser } from "@/lib/session";

// Live finds: every find in the bash with its +1s and additions, for the panel on Log a bug.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const finds = await bashFinds(id);
  if (!finds) return new Response(null, { status: 404 });
  // People outside the team who may be in this bash see it too.
  if (!user.isAdmin && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: finds.projectId, userId: user.id } } })) && !(await bashGuestOk(id, user.id))) return new Response(null, { status: 404 });
  const { projectId: _projectId, ...rest } = finds; // eslint-disable-line @typescript-eslint/no-unused-vars
  return Response.json(rest, { headers: { "Cache-Control": "no-store" } });
}
