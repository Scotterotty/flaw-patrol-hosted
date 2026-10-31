import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

// Waiting to join (ver_115): the home page and Ask to join page poll this, so they update as
// soon as an admin adds the person (or ignores the request).
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const [teams, requests] = await Promise.all([db.projectMember.count({ where: { userId: user.id } }), db.joinRequest.findMany({ where: { userId: user.id }, select: { id: true }, orderBy: { id: "asc" } })]);
  return Response.json({ v: `${teams}|${requests.map((r) => r.id).join(",")}` }, { headers: { "Cache-Control": "no-store" } });
}
