import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { attachmentInfo, attachmentStream, byteRange } from "@/lib/attachment-bytes";
import { db } from "@/lib/db";
import { bashGuestOk } from "@/lib/link-access-server";

async function bashItemGuest(itemId: string, userId: string) {
  const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true } });
  return !!item && !!(await bashGuestOk(item.bashId, userId));
}

// Serves an attachment to signed-in members of its project. The file is read from the
// database a slice at a time (attachment-bytes.ts), never whole: scrubbing a 100 MB video
// reads only the part being watched.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  const { id } = await params;
  const a = await attachmentInfo(id);
  if (!a) return new NextResponse("Not found", { status: 404 });
  const user = await db.user.findUnique({ where: { id: userId } });
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: a.projectId, userId } } });
  // Screenshots in a bug bash are for people outside the team who may be in it too.
  const guest = !member && !user?.isAdmin && (a.uploadedById === userId || (a.bashItemId && (await bashItemGuest(a.bashItemId, userId))));
  if (!user?.isAdmin && !member && !guest) return new NextResponse("Not found", { status: 404 });
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|video\/(mp4|webm))$/.test(a.contentType);
  // Videos are fetched in byte ranges so they can be scrubbed (Safari won't play them otherwise).
  const range = byteRange(req.headers.get("range"), a.bytes);
  if (range === "bad") return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${a.bytes}` } });
  const [start, end] = range ?? [0, a.bytes - 1];
  const extra: Record<string, string> = { "Accept-Ranges": "bytes" };
  if (range) extra["Content-Range"] = `bytes ${start}-${end}/${a.bytes}`;
  return new NextResponse(a.bytes ? attachmentStream(a.id, start, end) : null, {
    status: range ? 206 : 200,
    headers: {
      ...extra,
      "Content-Type": a.contentType,
      "Content-Length": String(a.bytes ? end - start + 1 : 0),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
