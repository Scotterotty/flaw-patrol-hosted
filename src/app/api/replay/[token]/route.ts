import { NextResponse } from "next/server";
import { attachmentInfo } from "@/lib/attachment-bytes";
import { attachmentResponse } from "@/lib/attachment-response";
import { db } from "@/lib/db";
import { replayTokenFile } from "@/lib/replay-link";
import { replayOrigin } from "@/lib/replay-origin";

// A replay file for the trace viewer on its separate address (src/lib/replay-origin.ts).
// Nobody is signed in there; the signed, short-lived link is the permission (replay-link.ts).
// src/middleware.ts only lets this path through on the replay address.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!replayOrigin()) return new NextResponse("Not found", { status: 404 });
  const fileId = replayTokenFile((await params).token);
  if (!fileId) return new NextResponse("This replay link has run out. Open the replay again from Flaw Patrol.", { status: 404 });
  const trace = await db.attachment.findFirst({ where: { id: fileId, kind: "trace" }, select: { id: true } });
  const a = trace && (await attachmentInfo(trace.id));
  if (!a) return new NextResponse("Not found", { status: 404 });
  return attachmentResponse(req, a, { "Cache-Control": "private, no-store" });
}
