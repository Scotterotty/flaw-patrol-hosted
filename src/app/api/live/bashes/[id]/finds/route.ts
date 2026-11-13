import { bashFinds, bashFindsVersion } from "@/lib/bash-live";
import { db } from "@/lib/db";
import { bashGuestOk } from "@/lib/link-access-server";
import { currentUser } from "@/lib/session";

// Live finds: every find in the bash with its +1s and additions, for the panel on Log a bug.
// With ?v= (the fingerprint the panel last got) and nothing changed, only { v } comes back:
// with 50 people in a bash, sending every find to everyone every 2 seconds kept the server busy.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const version = await bashFindsVersion(id);
  if (!version) return new Response(null, { status: 404 });
  // People outside the team who may be in this bash see it too.
  if (!user.isAdmin && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: version.projectId, userId: user.id } } })) && !(await bashGuestOk(id, user.id))) return new Response(null, { status: 404 });
  const headers = { "Cache-Control": "no-store" };
  if (new URL(req.url).searchParams.get("v") === version.v) return Response.json({ v: version.v, same: true }, { headers });
  const finds = await bashFinds(id);
  if (!finds) return new Response(null, { status: 404 });
  const { projectId: _projectId, ...rest } = finds; // eslint-disable-line @typescript-eslint/no-unused-vars
  return Response.json({ ...rest, v: version.v }, { headers });
}
