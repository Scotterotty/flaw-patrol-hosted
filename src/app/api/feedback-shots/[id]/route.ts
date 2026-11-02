import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

// A picture on a piece of feedback: for its sender and for workspace admins only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const shot = await db.feedbackShot.findUnique({ where: { id }, select: { contentType: true, data: true, feedback: { select: { userId: true } } } });
  if (!shot || (!user.isAdmin && shot.feedback.userId !== user.id)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(shot.data), {
    headers: {
      "Content-Type": shot.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
