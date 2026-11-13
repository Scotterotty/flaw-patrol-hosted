import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { readServerUpdate } from "@/lib/server-update-files";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * How an update is going (ver_239), for Workspace settings → Updates to follow along while
 * the helper builds and restarts. Workspace admins only. `running` is this server's version,
 * so the page can tell when the new one has taken over.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  const user = await db.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!user?.isAdmin) return new NextResponse("Not found", { status: 404 });
  const view = await readServerUpdate();
  return NextResponse.json({ ...view, running: APP_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
