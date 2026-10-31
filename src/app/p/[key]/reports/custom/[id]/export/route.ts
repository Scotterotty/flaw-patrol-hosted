import { NextResponse, type NextRequest } from "next/server";
import { cycleScope, reportsFor } from "@/lib/custom-report-scope";
import { customExport } from "@/lib/custom-report-route";
import { projectAccess } from "@/lib/session";

/** A test cycle's custom report as a PDF or Excel workbook (ver_101). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const { project, user, who } = await projectAccess(key);
  const report = (await reportsFor(project.id, user, who)).find((r) => r.id === id);
  if (!report) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return customExport(await cycleScope(project, user), report, Object.fromEntries(req.nextUrl.searchParams.entries()), user.name ?? user.email);
}
