import { NextResponse, type NextRequest } from "next/server";
import { queryObject, reportQuery } from "@/lib/custom-report-data";
import { reportsFor, umbrellaScope } from "@/lib/custom-report-scope";
import { customExport } from "@/lib/custom-report-route";
import { requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";

/** An umbrella's custom report as a PDF or Excel workbook. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const user = await requireUser();
  const { id, rid } = await params;
  const u = await loadUmbrella(id, user);
  if (!u) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const report = (await reportsFor(u.hub.id, user, u.who)).find((r) => r.id === rid);
  if (!report) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const platform = queryObject(reportQuery(report.query, sp)).platform ?? "";
  return customExport(await umbrellaScope(u, user, platform), report, sp, user.name ?? user.email);
}
