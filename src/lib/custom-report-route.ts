import "server-only";
import { NextResponse } from "next/server";
import { filtersOf, loader, queryObject, reportQuery, type CustomScope } from "./custom-report-data";
import { buildReport, customReportPdf, customReportWorkbook } from "./custom-report-export";
import type { ReportRow } from "./custom-report-scope";
import { dayIn } from "./zone";
import { viewerClock } from "./zone-server";

/** Export a custom report as a PDF or an Excel workbook, with the filters on screen. */
export async function customExport(cs: CustomScope, report: ReportRow, sp: Record<string, string>, preparedBy: string) {
  const q = queryObject(reportQuery(report.query, sp));
  const f = filtersOf(cs, q);
  const filters = cs.exportCtx(f, q).filters;
  const built = await buildReport(cs, loader(cs), report.items, q);
  // The day on the viewer's clock, so a 5 PM Pacific export isn't named tomorrow.
  const clock = await viewerClock();
  const day = dayIn(new Date(), clock.zone);
  const base = report.name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "report";
  if (sp.format === "xlsx") {
    const buf = await customReportWorkbook(report.name, filters, built, clock);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}-${day}.xlsx"` },
    });
  }
  if (sp.format === "pdf") {
    const bytes = await customReportPdf(report.name, filters, built, { preparedBy: sp.by === "1" ? preparedBy : null, logo: sp.logo === "1", clock });
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}-${day}.pdf"` } });
  }
  return NextResponse.json({ error: "Unknown export." }, { status: 400 });
}
