import "server-only";
import { NextResponse } from "next/server";
import { toCsv } from "./csv";
import { EXPORT_TABS, reportPdf, reportTable, reportWorkbook, type ExportCtx, type ExportTab } from "./report-export";
import type { ReportFilters } from "./reports";

const isTab = (v: string | undefined): v is ExportTab => EXPORT_TABS.some((t) => t.id === v);

/** The shared part of both Reports export routes: pick the format and send the file. */
export async function exportResponse(ctx: ExportCtx, f: ReportFilters, sp: Record<string, string>, opts: { fileBase: string; preparedBy: string }) {
  const format = sp.format ?? "csv";
  const day = new Date().toISOString().slice(0, 10);
  const base = opts.fileBase.replace(/[^\w.-]+/g, "_");
  if (format === "csv" || format === "json") {
    const view: ExportTab = isTab(sp.view) ? sp.view : "status";
    const t = await reportTable(ctx, view, f);
    if (!t) return null;
    // Copy for Confluence or email reads the same table as JSON.
    if (format === "json") return NextResponse.json({ label: t.label, title: ctx.title, filters: ctx.filters, rows: t.rows });
    return new NextResponse("﻿" + toCsv(t.rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}-${view}-report-${day}.csv"` },
    });
  }
  const picked = (sp.tabs ?? "").split(",").filter(isTab);
  const tabs = picked.length ? picked : EXPORT_TABS.map((t) => t.id).filter((t) => t !== "findings" || !!ctx.projectKey);
  if (format === "xlsx") {
    const buf = await reportWorkbook(ctx, f, tabs);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}-report-${day}.xlsx"` },
    });
  }
  if (format === "pdf") {
    const bytes = await reportPdf(ctx, f, tabs, { preparedBy: sp.by === "1" ? opts.preparedBy : null, logo: sp.logo === "1" });
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}-report-${day}.pdf"` },
    });
  }
  return null;
}
