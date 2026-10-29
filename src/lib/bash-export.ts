import "server-only";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { sevLabel } from "./bash";
import type { BashReport } from "./bash-summary";
import { MUTED, PdfWriter, safe, type Cell } from "./report-export";

// A bug bash report as CSV, Excel, PDF or a table to paste into Confluence (ver_93),
// for the Export menu every Reports page has.

const keyOf = (b: BashReport["bugs"][number]) => (b.bug ? (b.bug.externalKey ?? `D-${b.bug.number}`) : "");

export function bashTables(r: BashReport): { label: string; rows: Cell[][] }[] {
  const area = (id: string) => r.areas.find((a) => a.id === id)?.name ?? "";
  return [
    {
      label: "Summary",
      rows: [
        ["What", "Count"],
        ["Bugs found", r.bugs.length],
        ["High or Blocker", r.high],
        ["Questions raised", r.questions],
        ["+1s on bugs", r.plusOnes],
        ["People", r.people],
        ...(r.vsLast ? [[`Bugs vs ${r.vsLast.name}`, `${r.vsLast.diff >= 0 ? "+" : ""}${r.vsLast.diff}`] as Cell[]] : []),
      ],
    },
    { label: "Bugs", rows: [["Bug", "Key", "Severity", "Area", "Logged by", "Also seen by"], ...r.bugs.map((b) => [b.text, keyOf(b) || (b.review === "skip" ? "Left out" : r.bash.wrappedAt ? "Not filed" : ""), r.sevNames[b.severity], area(b.areaId), b.byName, b.plusOnes.map((p) => p.name).join(", ")])] },
    { label: "Bugs by area", rows: [["Area", "Bugs"], ...r.byArea.map((a) => [a.name, a.bugs])] },
    { label: "What got covered", rows: [["Area", "Prompts covered", "Notes", "Not touched"], ...r.coverage.map((c) => [c.name, c.prompts ? `${c.covered} of ${c.prompts}` : "Blank charter", c.notes, c.untouched.join("; ")])] },
  ];
}

export async function bashWorkbook(r: BashReport) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flaw Patrol";
  for (const t of bashTables(r)) {
    const ws = wb.addWorksheet(t.label);
    t.rows.forEach((row, i) => (ws.addRow(row).font = i === 0 ? { bold: true } : {}));
    ws.columns.forEach((c) => {
      let w = 8;
      c.eachCell?.({ includeEmpty: false }, (cell) => (w = Math.max(w, Math.min(60, String(cell.value ?? "").length + 2))));
      c.width = w;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function bashPdf(r: BashReport, title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Flaw Patrol");
  const pdf = new PdfWriter(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), safe(`${title} · made ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC with Flaw Patrol`));
  pdf.newPage();
  pdf.heading(title);
  pdf.text(`${r.when} · started by ${r.bash.createdBy} · ${r.people} people · ${r.areas.length} areas`, 10, { color: MUTED });
  pdf.tiles([
    { label: "Bugs found", value: String(r.bugs.length) },
    { label: "High or Blocker", value: String(r.high) },
    { label: "Questions raised", value: String(r.questions) },
    { label: r.vsLast ? `Bugs vs ${r.vsLast.name}` : "+1s on bugs", value: r.vsLast ? `${r.vsLast.diff >= 0 ? "+" : ""}${r.vsLast.diff}` : String(r.plusOnes) },
  ]);
  for (const t of bashTables(r).slice(1)) {
    pdf.heading(t.label);
    if (t.rows.length <= 1) pdf.text("Nothing here.", 10, { color: MUTED });
    else pdf.table(t.rows);
  }
  return doc.save();
}
