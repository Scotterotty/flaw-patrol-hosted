import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { bashGuestOk } from "@/lib/link-access-server";

async function bashItemGuest(itemId: string, userId: string) {
  const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true } });
  return !!item && !!(await bashGuestOk(item.bashId, userId));
}

// Serves an attachment to signed-in members of its project.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  const { id } = await params;
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a) return new NextResponse("Not found", { status: 404 });
  const user = await db.user.findUnique({ where: { id: userId } });
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: a.projectId, userId } } });
  // Screenshots in a bug bash are for people outside the team who may be in it too (ver_115).
  const guest = !member && !user?.isAdmin && (a.uploadedById === userId || (a.bashItemId && (await bashItemGuest(a.bashItemId, userId))));
  if (!user?.isAdmin && !member && !guest) return new NextResponse("Not found", { status: 404 });
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|video\/(mp4|webm))$/.test(a.contentType);
  const data = new Uint8Array(a.data);
  // Videos are fetched in byte ranges so they can be scrubbed (Safari won't play them otherwise).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let body = data;
  let status = 200;
  const extra: Record<string, string> = { "Accept-Ranges": "bytes" };
  // An empty file has no bytes to give, so it goes out whole (not as a 416 error).
  if (range && (range[1] || range[2]) && data.length) {
    const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    if (start >= data.length || start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${data.length}` } });
    body = data.subarray(start, end + 1);
    status = 206;
    extra["Content-Range"] = `bytes ${start}-${end}/${data.length}`;
  }
  return new NextResponse(body, {
    status,
    headers: {
      ...extra,
      "Content-Type": a.contentType,
      "Content-Length": String(body.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
