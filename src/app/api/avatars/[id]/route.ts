import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

// Profile pictures, for signed-in people only. The URL carries ?v=<avatarAt>
// so a new picture gets a new URL and old ones can be cached for a long time.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const u = await db.user.findUnique({ where: { id }, select: { avatar: true, avatarType: true } });
  if (!u?.avatar || !u.avatarType) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(u.avatar), {
    headers: {
      "Content-Type": u.avatarType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
