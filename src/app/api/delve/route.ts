import { cleanKeys } from "@/lib/delve";
import { dungeonsFor } from "@/lib/delve-data";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

const NO_STORE = { "Cache-Control": "no-store" };

// The hidden page's save and dungeons. Everything here is the signed-in person's own: there is no
// way to ask for someone else's, and nothing reads it for reports, activity or admins.
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const [save, dungeons] = await Promise.all([db.delveSave.findUnique({ where: { userId: user.id } }), dungeonsFor(user)]);
  return Response.json({ save: { keys: save?.keys ?? {} }, cleared: save?.cleared ?? [], dungeons }, { headers: NO_STORE });
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const body = await req.json().catch(() => null);
  const keys = cleanKeys(body?.keys);
  if (!keys) return Response.json({ error: "That save is too big or not a save." }, { status: 400 });
  await db.delveSave.upsert({ where: { userId: user.id }, create: { userId: user.id, keys }, update: { keys } });
  return new Response(null, { status: 204 });
}

/** The same save, sent with navigator.sendBeacon as the page closes (beacons can only POST). */
export async function POST(req: Request) {
  return PUT(req);
}
