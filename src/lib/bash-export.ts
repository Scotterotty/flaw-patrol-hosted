import "server-only";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { seenOn } from "./bash";
import type { BashReport } from "./bash-summary";
import { MUTED, PdfWriter, safe, type Cell } from "./report-export";
import { madeAt, UTC_CLOCK, type Clock } from "./spelling";

// A bug bash report as CSV, Excel, PDF or a table to paste into Confluence,
// for the Export menu every Reports page has.

const keyOf = (b: BashReport["bugs"][number]) => (b.bug ? (b.bug.externalKey ?? `D-${b.bug.number}`) : "");

export function bashTables(r: BashReport): { label: string; rows: Cell[][] }[] {
  const area = (id: string) => r.areas.find((a) => a.id === id)?.name ?? "";
  // Platforms (ver_146): a "Seen on" column and a table, only when someone gave a platform.
  const plat = r.byPlatform.length > 0;
  return [
    {
      label: "Summary",
      rows: [
        ["What", "Count"],
        ["Bugs found", r.bugs.length],
        ["High or Blocker", r.high],
        ["Questions raised", r.questions],
        ["Questions not answered", r.unanswered],
        ["Notes", r.notes],
        ["Ideas", r.ideas],
        ["+1s on bugs", r.plusOnes],
        ["People", r.people],
        ...(r.vsLast ? [[`Bugs vs ${r.vsLast.name}`, `${r.vsLast.diff >= 0 ? "+" : ""}${r.vsLast.diff}`] as Cell[]] : []),
      ],
    },
    {
      label: "Bugs",
      rows: [
        ["Bug", "Key", "Severity", "Area", "Logged by", "Also seen by", ...(plat ? ["Seen on"] : [])],
        ...r.bugs.map((b) => [b.text, keyOf(b) || (b.review === "skip" ? "Left out" : r.bash.wrappedAt ? "Not filed" : ""), r.sevNames[b.severity], area(b.areaId), b.byName, b.plusOnes.map((p) => p.name).join(", "), ...(plat ? [seenOn(b).join(", ")] : [])]),
      ],
    },
    { label: "Bugs by area", rows: [["Area", "Bugs", "Links"], ...r.byArea.map((a) => [a.name, a.bugs, (r.areas.find((x) => x.id === a.id)?.links ?? []).map((l) => `${l.key} ${l.url}`.trim()).join("; ")])] },
    ...(plat ? [{ label: "Bugs by platform", rows: [["Platform", "Bugs", "High or Blocker", "Only seen here", "Also seen elsewhere"], ...r.byPlatform.map((p) => [p.platform || "Didn't say", p.bugs, p.high, p.onlyHere, p.elsewhere])] as Cell[][] }] : []),
    {
      label: "Everything found",
      rows: [
        ["Kind", "Find", "Area", "Logged by", "+1s", "Added or answered", "Key"],
        ...r.finds.map((f) => [f.kind[0].toUpperCase() + f.kind.slice(1), f.text, area(f.areaId), f.byName, f.plusOnes.map((p) => p.name).join(", "), f.adds.map((a) => `${a.byName}: ${a.text}`).join("; ") || (f.kind === "question" ? "Not answered" : ""), keyOf(f)]),
      ],
    },
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

export async function bashPdf(r: BashReport, title: string, clock: Clock = UTC_CLOCK) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Flaw Patrol");
  const pdf = new PdfWriter(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), safe(`${title} · made ${madeAt(new Date(), clock.spelling, clock.zone)} with Flaw Patrol`));
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
