import JSZip from "jszip";
import { runTitle } from "@/lib/run-label";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// Download all files: one result's screenshots, videos and replays as a zip.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new NextResponse("Sign in first", { status: 401 });
  const { id } = await params;
  const result = await db.testResult.findUnique({ where: { id }, select: { run: { select: { projectId: true, number: true, name: true, build: true, createdAt: true } }, entry: { select: { title: true } }, attachments: true } });
  if (!result) return new NextResponse("Not found", { status: 404 });
  const user = await db.user.findUnique({ where: { id: userId } });
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: result.run.projectId, userId } } });
  if (!user?.isAdmin && !member) return new NextResponse("Not found", { status: 404 });
  const zip = new JSZip();
  const seen = new Set<string>();
  for (const a of result.attachments) {
    // Retried tests: each attempt's files go in their own folder.
    const tries = new Set(result.attachments.map((x) => x.attempt ?? 1)).size;
    // Only the file's own name, never a folder path from an upload (review: zip-slip).
    const own = a.fileName.split(/[\\/]/).filter((p) => p && p !== "." && p !== "..").pop() || "file";
    let name = tries > 1 && a.attempt ? `attempt-${a.attempt}/${own}` : own;
    for (let i = 2; seen.has(name); i++) name = name.replace(/(-\d+)?(\.[^.]+)?$/, `-${i}$2`);
    seen.add(name);
    zip.file(name, a.data);
  }
  const body = await zip.generateAsync({ type: "arraybuffer" });
  const base = `${runTitle(result.run)}-${result.entry.title}`.replace(/[^\w.-]+/g, "-").slice(0, 80);
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${base}-files.zip"`, "Content-Length": String(body.byteLength) } });
}
