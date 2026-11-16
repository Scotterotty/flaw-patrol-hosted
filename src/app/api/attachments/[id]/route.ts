import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { attachmentInfo } from "@/lib/attachment-bytes";
import { attachmentResponse } from "@/lib/attachment-response";
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
  return attachmentResponse(req, a);
}
