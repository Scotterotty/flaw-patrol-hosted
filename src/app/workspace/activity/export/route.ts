import { NextResponse, type NextRequest } from "next/server";
import { ACTIVITY_KINDS } from "@/lib/activity";
import { activityWhere } from "@/lib/activity-query";
import { toCsv } from "@/lib/csv";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

/** Workspace settings → Activity log → Export CSV: every entry the filters match. */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user?.isAdmin) return new NextResponse("Only workspace admins can export the activity log.", { status: 403 });
  const f = Object.fromEntries(req.nextUrl.searchParams.entries());
  const entries = await db.activityEntry.findMany({ where: activityWhere(f), orderBy: { at: "desc" }, take: 50_000 });
  const csv = toCsv([
    ["When (UTC)", "Who", "Type", "What", "Where", "Details", "IP address"],
    ...entries.map((e) => [e.at.toISOString().replace("T", " ").slice(0, 19), e.actorLabel, ACTIVITY_KINDS[e.kind as keyof typeof ACTIVITY_KINDS] ?? e.kind, e.action, e.where, e.detail, e.ip ?? ""]),
  ]);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="flaw-patrol-activity-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
