import { NextResponse, type NextRequest } from "next/server";
import { bashPdf, bashTables, bashWorkbook } from "@/lib/bash-export";
import { bashReport } from "@/lib/bash-summary";
import { toCsv } from "@/lib/csv";
import { projectAccess } from "@/lib/session";
import { viewerClock } from "@/lib/zone-server";

/** A bug bash report's Export: CSV of the bugs, Excel, PDF, or JSON for Copy for Confluence. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const { project } = await projectAccess(key);
  // Times on the viewer's clock, like the report page.
  const clock = await viewerClock();
  const r = await bashReport(id, clock);
  if (!r || r.bash.projectId !== project.id) return new NextResponse("Not found", { status: 404 });
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const title = `Bug bash · ${r.bash.name}`;
  const base = `bug-bash-${r.bash.name}`.replace(/[^\w.-]+/g, "_");
  if (format === "json") return NextResponse.json({ title, sub: [`${r.when} · started by ${r.bash.createdBy} · ${r.people} people`], tables: bashTables(r) });
  if (format === "xlsx")
    return new NextResponse(new Uint8Array(await bashWorkbook(r)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` } });
  if (format === "pdf") return new NextResponse(new Uint8Array(await bashPdf(r, title, clock)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
  return new NextResponse("﻿" + toCsv(bashTables(r)[1].rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}-bugs.csv"` } });
}
