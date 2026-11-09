import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { boardScope } from "@/lib/bug-board-server";
import { jiraFor } from "@/lib/jira";

/**
 * A Jira attachment for the bug panel (ver_211), through Flaw Patrol's Jira login so people
 * without Jira can see screenshots and logs. ?g=<umbrella> or ?p=<test cycle>, &id=<attachment>.
 * Only pictures, PDFs and plain text open in the browser; everything else downloads.
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, isAdmin: true } });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const scope = user && /^\d+$/.test(id) ? await boardScope({ groupId: url.searchParams.get("g"), projectId: url.searchParams.get("p") }, user) : null;
  if (!scope) return new NextResponse("Not found", { status: 404 });
  const client = await jiraFor(scope.jiraProjectId).catch(() => null);
  const res = client ? await client.attachment(id).catch(() => null) : null;
  if (!res?.body) return new NextResponse("Not found", { status: 404 });
  const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(type);
  const name = url.searchParams.get("name")?.slice(0, 200) || `attachment-${id}`;
  return new NextResponse(res.body, {
    headers: {
      "Content-Type": inline ? type : "application/octet-stream",
      ...(res.headers.get("content-length") ? { "Content-Length": res.headers.get("content-length")! } : {}),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=600",
    },
  });
}
