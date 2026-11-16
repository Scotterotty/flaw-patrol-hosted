import { FIRST_CLEAR_BONUS } from "@/lib/delve";
import { dungeonsFor } from "@/lib/delve-data";
import { db } from "@/lib/db";
import { funOff } from "@/lib/fun";
import { currentUser } from "@/lib/session";

// First clear of a run's dungeon: pays the bonus once per run, however often it's asked.
export async function POST(req: Request) {
  if (funOff()) return new Response(null, { status: 404 });
  const user = await currentUser();
  if (!user) return new Response(null, { status: 401 });
  const body = await req.json().catch(() => null);
  const runId = typeof body?.runId === "string" ? body.runId : "";
  if (!runId || !(await dungeonsFor(user)).some((d) => d.id === runId)) return Response.json({ bonus: 0 }, { status: 404 });
  const bonus = await db.$transaction(async (tx) => {
    const save = await tx.delveSave.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    if (save.cleared.includes(runId)) return 0;
    const done = await tx.delveSave.updateMany({ where: { userId: user.id, NOT: { cleared: { has: runId } } }, data: { cleared: { push: runId } } });
    return done.count ? FIRST_CLEAR_BONUS : 0;
  });
  return Response.json({ bonus }, { headers: { "Cache-Control": "no-store" } });
}
