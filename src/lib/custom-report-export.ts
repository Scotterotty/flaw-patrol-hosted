import "server-only";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { filtersOf, partQuery, type CustomScope, type Loader } from "./custom-report-data";
import { ACCENT, HEAD, INK, LINE, MUTED, outcomes, PDF_COLS, PdfWriter, rcTable, reportTable, safe, STATUS_RGB, type Cell } from "./report-export";
import { headingOf, layoutRows, ownLabel, partOf, tabLabel, type ReportItem, type ReportPart } from "./report-parts";
import { manualLine, splitProgress } from "./progress-split";
import { countStatuses, pct, STATUS_LABEL, STATUSES, totals, type StatusCounts } from "./status";
import { wrapLine } from "./wrap-up-text";

// Custom reports as a PDF and an Excel workbook. Each part becomes a few blocks
// (numbers, bars, a chart, a table), measured before drawing so the PDF never cuts one in half.

type Point = { label: string; value: number | null };
export type Block =
  | { k: "tiles"; list: { label: string; value: string }[] }
  | { k: "bar"; label: string; counts: StatusCounts }
  | { k: "line"; label: string; series: { name: string; color: "manual" | "auto"; points: Point[] }[] }
  | { k: "columns"; label: string; points: { label: string; value: number }[] }
  | { k: "table"; rows: Cell[][]; keep?: string[] }
  | { k: "text"; text: string };
export type PartOut = { heading: string; from: string; own: string | null; blocks: Block[] };

const sum = (list: StatusCounts[]) => countStatuses(list.flatMap((c) => STATUSES.flatMap((s) => Array(c[s]).fill(s))));
const runName = (cs: CustomScope, r: { projectKey: string; platform: string; number: number }) => (cs.umbrella ? `${r.platform || r.projectKey} R${r.number}` : `R${r.number}`);
const nothing = (text: string): Block[] => [{ k: "text", text }];

/** The blocks one part turns into. */
export async function partBlocks(cs: CustomScope, load: Loader, it: ReportPart, q: Record<string, string | undefined>): Promise<Block[]> {
  const part = it.part;
  const pq = partQuery(q, it.own);
  const f = filtersOf(cs, pq);
  const ctx = cs.exportCtx(f, pq);
  const table = async (tab: Parameters<typeof reportTable>[1], keep?: string[]): Promise<Block[]> => {
    const t = await reportTable(ctx, tab, f);
    if (!t || t.rows.length <= 1) return nothing("Nothing in this range.");
    return [...(t.note ? [{ k: "text", text: t.note } as Block] : []), { k: "table", rows: t.rows, keep }];
  };
  switch (part) {
    case "rc": {
      const rc = await rcTable(ctx, f);
      return rc ? [{ k: "text", text: rc.release }, { k: "table", rows: rc.rows }] : nothing("No runs have a release yet.");
    }
    case "requirements": {
      const t = await reportTable(ctx, "requirements", f);
      return t && t.rows.length > 1 ? [{ k: "table", rows: t.rows }] : nothing(String(t?.rows[0]?.[0] ?? "No requirements are linked to cases yet."));
    }
    case "wrapups": {
      const items = await load.wrapUps(f);
      if (!items.length) return nothing("No bug bashes or exploring sessions were saved in this range.");
      return [{ k: "text", text: "Not counted in pass rates." }, { k: "table", rows: [["Wrap-up", "Kind", "When", "Details", "Summary"], ...items.map((w) => [w.title, w.type === "bash" ? "Bug bash" : "Exploratory", w.at.slice(0, 10), safe(wrapLine(w)), w.summary || w.worst])] }];
    }
    case "regression": {
      const r = await load.regression();
      if (!r.newer || !r.older) return nothing("Nothing to compare yet.");
      return [{ k: "text", text: `${r.newer} compared with ${r.older}` }, ...(await table("regression"))];
    }
    case "defects.tiles":
    case "defects.list": {
      const [rows, scale] = await Promise.all([load.defects(f), load.scale()]);
      const list = it.own?.critical ? rows.filter((r) => (scale.critical as string[]).includes(r.severity)) : rows;
      if (part === "defects.tiles") {
        const open = list.filter((r) => r.open).length;
        return [{ k: "tiles", list: [{ label: "Bugs found", value: String(list.length) }, { label: "Still open", value: String(open) }, { label: "Fixed or closed", value: String(list.length - open) }, { label: "Critical", value: String(list.filter((r) => (scale.critical as string[]).includes(r.severity)).length) }] }];
      }
      if (!list.length) return nothing("No bugs were linked to results in this range.");
      return [{ k: "table", rows: [["Bug", "Title", "Status", "Severity", "Found in"], ...list.map((d) => [d.key, d.title, d.status, scale.labels[d.severity as keyof typeof scale.labels] ?? d.severity, d.foundIn.map((x) => `${x.caseKey}${x.step !== null ? ` step ${x.step}` : ""} R${x.run}`).join("; ")])] }];
    }
    case "cases.failing":
    case "cases.flaky": {
      const rows = await load.cases(f);
      const list = part === "cases.failing" ? rows.filter((r) => r.failStreak > 0).sort((a, b) => b.failStreak - a.failStreak).slice(0, 15) : rows.filter((r) => r.flips >= 2).sort((a, b) => b.flips - a.flips).slice(0, 15);
      if (!list.length) return nothing("None.");
      return [{ k: "table", rows: [["Case", "Title", part === "cases.failing" ? "Failed in a row" : "Flips"], ...list.map((r) => [r.caseKey, r.title, part === "cases.failing" ? r.failStreak : r.flips])] }];
    }
    case "cases.all":
      return table("cases", PDF_COLS.cases);
    case "failing.tiles": {
      const rows = await load.steps(f);
      return [{ k: "tiles", list: [{ label: "Steps that failed", value: String(rows.filter((r) => r.failures > 0).length) }, { label: "Step failures", value: String(rows.reduce((n, r) => n + r.failures, 0)) }, { label: "Failing now", value: String(rows.filter((r) => r.streak > 0).length) }, { label: "Most failures", value: String(rows[0]?.failures ?? 0) }] }];
    }
    case "failing.history":
      return table("failing", PDF_COLS.failing);
    case "steps.failmost": {
      const rows = (await load.steps(f)).filter((r) => r.failures > 0).slice(0, 5);
      if (!rows.length) return nothing("No failed steps in this range.");
      return [{ k: "table", rows: [["Case", "Step", "Action", "Failures", "Fail rate"], ...rows.map((s) => [s.caseKey, s.step, s.action, `${s.failures} of ${s.runs}`, pct(s.failRate)])] }];
    }
  }
  if (part.startsWith("trends.")) {
    const t = await load.trends(f);
    if (t.results === 0) return nothing("No saved results match these filters.");
    const buckets = t.buckets.slice(-24);
    if (part === "trends.passrate")
      return [
        {
          k: "line",
          label: `Pass rate per ${t.unit}`,
          series:
            t.manual && t.automated
              ? [
                  { name: "Manual", color: "manual", points: buckets.map((b) => ({ label: b.label, value: b.manualRate ?? null })) },
                  { name: "Automated", color: "auto", points: buckets.map((b) => ({ label: b.label, value: b.autoRate ?? null })) },
                ]
              : [{ name: "Pass rate", color: "manual", points: buckets.map((b) => ({ label: b.label, value: b.passRate })) }],
        },
      ];
    if (part === "trends.results") return [{ k: "columns", label: `Results per ${t.unit}`, points: buckets.map((b) => ({ label: b.label, value: totals(b.counts).tested })) }];
    if (part === "trends.bugs") return [{ k: "columns", label: `Bugs found per ${t.unit}`, points: buckets.map((b) => ({ label: b.label, value: b.bugs })) }];
    return [{ k: "table", rows: [["Release", "Runs", "Passed", "Failed", "Pass rate", "Bugs found"], ...t.releases.map((r) => [r.release, r.runs, r.counts.PASSED, r.counts.FAILED, pct(r.passRate), r.bugs])] }];
  }
  // Execution status and Step results.
  const runs = await load.runs(f);
  if (!runs.length) return nothing("No test runs match these filters.");
  const { manual, auto } = splitProgress(runs);
  switch (part) {
    case "status.cycles": {
      const byCycle = new Map<string, typeof runs>();
      for (const r of runs) byCycle.set(r.projectName, [...(byCycle.get(r.projectName) ?? []), r]);
      const rows: Cell[][] = [["Test cycle", "Who ran it", "Runs", "Done", "Passed", "Failed", "Bugs"]];
      for (const [name, list] of byCycle) {
        const s = splitProgress(list);
        if (s.manual.runs) rows.push([name, "Manual", s.manual.runs, `${totals(s.manual.counts).tested} / ${totals(s.manual.counts).total}`, pct(totals(s.manual.counts).passRate), s.manual.counts.FAILED, s.manual.bugs]);
        if (s.auto.runs) rows.push([s.manual.runs ? "" : name, "Automated", s.auto.runs, `${totals(s.auto.latest).tested} / ${totals(s.auto.latest).total}`, pct(totals(s.auto.latest).passRate), s.auto.latest.FAILED, s.auto.bugs]);
      }
      return [{ k: "table", rows }];
    }
    case "status.tiles": {
      const hand = manualLine(manual);
      return [
        {
          k: "tiles",
          list: [
            { label: manual.runs && auto.runs ? `Runs (${manual.runs} manual, ${auto.runs} automated)` : "Runs", value: String(runs.length) },
            ...(manual.runs ? [{ label: manual.inProgress ? `Manual: finished (${manual.inProgress} in progress)` : "Manual: tested by hand", value: `${hand.tested} of ${hand.total}` }] : []),
            ...(auto.runs ? [{ label: "Automated: passed on latest run", value: `${auto.latest.PASSED} of ${auto.cases}` }] : []),
            { label: "Bugs found", value: String(manual.bugs + auto.bugs) },
          ],
        },
      ];
    }
    case "status.cases":
      return [...(manual.runs ? [{ k: "bar", label: "Manual testing: cases by result", counts: manual.counts } as Block] : []), ...(auto.runs ? [{ k: "bar", label: "Automated tests: latest result of each case", counts: auto.latest } as Block] : [])];
    case "status.passrate": {
      const ordered = [...runs].reverse().slice(-30);
      const point = (want: boolean) => ordered.map((r) => ({ label: runName(cs, r), value: (r.source !== "manual") === want ? totals(r.counts).passRate : null }));
      return [
        {
          k: "line",
          label: "Pass rate by run",
          series: [...(manual.runs ? [{ name: "Manual", color: "manual" as const, points: point(false) }] : []), ...(auto.runs ? [{ name: "Automated", color: "auto" as const, points: point(true) }] : [])],
        },
      ];
    }
    case "status.suites": {
      const suites = await load.suites(f, runs);
      if (!suites.length) return nothing("No test suites yet.");
      return [{ k: "table", rows: [["Suite", "Version", "Cases", "Runs", "Latest run", "Done", "Passed"], ...suites.map((s) => [s.name, `v${s.version}`, s.cases, s.runs, s.latest ? runName(cs, s.latest) : "Not run", s.latest ? `${Math.round(totals(s.latest.counts).progress * 100)}%` : "", s.latest ? pct(totals(s.latest.counts).passRate) : ""])] }];
    }
    case "status.runs":
      return table("status", PDF_COLS.status);
    case "steps.tiles": {
      const c = sum(runs.map((r) => r.steps));
      const t = totals(c);
      return [{ k: "tiles", list: [{ label: "Steps executed", value: String(t.tested) }, { label: "Passed steps", value: `${c.PASSED} (${pct(t.passRate)})` }, { label: "Failed steps", value: String(c.FAILED) }, { label: "Blocked", value: String(c.BLOCKED) }] }];
    }
    case "steps.outcomes":
      return manual.runs && auto.runs ? [{ k: "bar", label: "Manual testing: steps", counts: manual.steps }, { k: "bar", label: "Automated tests: steps", counts: auto.steps }] : [{ k: "bar", label: "Steps by result", counts: sum(runs.map((r) => r.steps)) }];
    case "steps.byrun":
      return table("steps", PDF_COLS.steps);
  }
  return nothing("Not available here.");
}

export type BuiltPart = { item: ReportItem } & ({ kind: "note"; text: string } | { kind: "part"; out: PartOut });

/** Every part of the report, in order, with its blocks. */
export async function buildReport(cs: CustomScope, load: Loader, items: ReportItem[], q: Record<string, string | undefined>): Promise<BuiltPart[]> {
  return Promise.all(
    items.map(async (it): Promise<BuiltPart> => {
      if (it.k === "note") return { item: it, kind: "note", text: it.text };
      let blocks: Block[];
      try {
        blocks = await partBlocks(cs, load, it, q);
      } catch (e) {
        console.error("custom report export", it.part, e);
        blocks = nothing("This part couldn't load.");
      }
      return { item: it, kind: "part", out: { heading: headingOf(it), from: tabLabel(partOf(it.part).tab), own: ownLabel(it.own), blocks } };
    }),
  );
}

// ——— PDF ———

const ROW = 14;
const MIN_ROWS = 3;
const CHART_H = 120;
const BLUE = rgb(0.23, 0.51, 0.96);
const TEAL = rgb(0.08, 0.6, 0.55);

/** Keeps parts whole: measures each part first and moves it to a new page when it won't fit. */
class ReportWriter extends PdfWriter {
  get bottom() {
    return this.m + 10;
  }
  get usable() {
    return this.h - 2 * this.m - 10;
  }
  get atTop() {
    return this.y >= this.h - this.m - 1;
  }

  /** Lines of text wrapped to the page width (notes keep every word). */
  wrap(text: string, size: number, width = this.w - 2 * this.m) {
    const out: string[] = [];
    for (const para of text.split(/\n/)) {
      let line = "";
      for (const word of safe(para).split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (this.font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }

  tableBlocks(rows: Cell[][]) {
    const blocks: Cell[][][] = [[]];
    for (const r of rows) {
      if (!r.length) blocks.push([]);
      else blocks.at(-1)!.push(r);
    }
    return blocks.filter((b) => b.length);
  }

  blockHeight(b: Block): number {
    switch (b.k) {
      case "tiles":
        return 52;
      case "bar":
        return 13 + 16 + 16.5;
      case "line":
      case "columns":
        return 13 + CHART_H + 20;
      case "text":
        return this.wrap(b.text, 9).length * 12 + 4;
      case "table":
        return this.tableBlocks(b.rows).reduce((n, t) => n + t.length * ROW + 10, 0);
    }
  }
  /** Height of the heading plus what has to come with it: the first block, or a table's first rows. */
  firstHeight(blocks: Block[]) {
    const head = 38;
    const lead = blocks.findIndex((b) => b.k === "table");
    const before = blocks.slice(0, lead < 0 ? blocks.length : lead).reduce((n, b) => n + this.blockHeight(b), 0);
    return head + before + (lead < 0 ? 0 : ROW * (1 + MIN_ROWS));
  }
  partHeight(p: PartOut) {
    return 38 + p.blocks.reduce((n, b) => n + this.blockHeight(b), 0);
  }

  partHeading(p: PartOut, cont = false) {
    this.y -= 8;
    this.y -= 14;
    const title = safe(cont ? `${p.heading} (continued)` : p.heading);
    this.page.drawText(this.fit(title, 14, this.w - 2 * this.m - 160, this.bold), { x: this.m, y: this.y, size: 14, font: this.bold, color: INK });
    const tag = safe([p.from, !cont && p.own].filter(Boolean).join(" · "));
    const tw = this.font.widthOfTextAtSize(tag, 8);
    this.page.drawText(tag, { x: this.w - this.m - tw, y: this.y + 2, size: 8, font: this.font, color: MUTED });
    this.y -= 6;
    this.page.drawLine({ start: { x: this.m, y: this.y }, end: { x: this.w - this.m, y: this.y }, thickness: 1, color: ACCENT });
    this.y -= 10;
  }

  note(text: string) {
    const lines = this.wrap(text, 10);
    const h = lines.length * 14 + 12;
    this.page.drawRectangle({ x: this.m, y: this.y - h, width: this.w - 2 * this.m, height: h, borderColor: LINE, borderWidth: 1, borderDashArray: [3, 3] });
    this.y -= 8;
    for (const l of lines) {
      this.y -= 11;
      this.page.drawText(l, { x: this.m + 8, y: this.y, size: 10, font: this.font, color: INK });
      this.y -= 3;
    }
    this.y -= 12;
  }
  noteHeight(text: string) {
    return this.wrap(text, 10).length * 14 + 12 + 12;
  }

  drawBlock(b: Block, p: PartOut) {
    switch (b.k) {
      case "tiles":
        return this.tiles(b.list);
      case "bar":
        return this.statusBar(b.counts, b.label);
      case "text":
        for (const l of this.wrap(b.text, 9)) this.text(l, 9, { color: MUTED, gap: 3 });
        this.y -= 4;
        return;
      case "line":
        return this.lineChart(b);
      case "columns":
        return this.columnChart(b);
      case "table":
        return this.keptTable(b.rows, b.keep, p);
    }
  }

  statusBar(counts: StatusCounts, label: string) {
    const total = STATUSES.reduce((n, s) => n + counts[s], 0);
    this.text(label, 9, { color: MUTED });
    const width = this.w - 2 * this.m;
    let x = this.m;
    this.y -= 12;
    if (!total) this.page.drawRectangle({ x, y: this.y, width, height: 12, color: LINE });
    for (const s of STATUSES) {
      if (!counts[s]) continue;
      const wd = (counts[s] / total) * width;
      this.page.drawRectangle({ x, y: this.y, width: wd, height: 12, color: STATUS_RGB[s] ?? LINE });
      x += wd;
    }
    this.y -= 4;
    this.text(outcomes(counts) || "No results", 8.5, { color: MUTED, gap: 8 });
  }

  axes(top: number, label: string, max: string, mid: string) {
    this.page.drawText(safe(label), { x: this.m, y: top - 9, size: 9, font: this.font, color: MUTED });
    const y0 = top - 13 - CHART_H;
    const left = this.m + 28;
    for (const [frac, t] of [
      [1, max],
      [0.5, mid],
      [0, "0"],
    ] as const) {
      const y = y0 + frac * (CHART_H - 10);
      this.page.drawLine({ start: { x: left, y }, end: { x: this.w - this.m, y }, thickness: 0.5, color: LINE });
      this.page.drawText(t, { x: this.m, y: y - 3, size: 7, font: this.font, color: MUTED });
    }
    return { y0, left, width: this.w - this.m - left, height: CHART_H - 10 };
  }

  lineChart(b: Extract<Block, { k: "line" }>) {
    const top = this.y;
    const { y0, left, width, height } = this.axes(top, b.label, "100%", "50%");
    const n = Math.max(1, ...b.series.map((s) => s.points.length));
    const x = (i: number) => left + 10 + (n === 1 ? width / 2 : (i * (width - 20)) / (n - 1));
    b.series.forEach((s) => {
      const color = s.color === "auto" ? TEAL : BLUE;
      let prev: { x: number; y: number } | null = null;
      s.points.forEach((p, i) => {
        if (p.value === null) return;
        const pt = { x: x(i), y: y0 + p.value * height };
        if (prev) this.page.drawLine({ start: prev, end: pt, thickness: 1.5, color });
        this.page.drawCircle({ x: pt.x, y: pt.y, size: 2.5, color });
        prev = pt;
      });
    });
    const labels = b.series[0]?.points ?? [];
    const every = Math.ceil(labels.length / 16);
    labels.forEach((p, i) => i % every === 0 && this.page.drawText(this.fit(safe(p.label), 6, 40), { x: x(i) - 8, y: y0 - 9, size: 6, font: this.font, color: MUTED }));
    if (b.series.length > 1) {
      let lx = this.w - this.m - 140;
      for (const s of b.series) {
        this.page.drawCircle({ x: lx, y: top - 6, size: 3, color: s.color === "auto" ? TEAL : BLUE });
        this.page.drawText(s.name, { x: lx + 6, y: top - 9, size: 8, font: this.font, color: MUTED });
        lx += 70;
      }
    }
    this.y = y0 - 20;
  }

  columnChart(b: Extract<Block, { k: "columns" }>) {
    const top = this.y;
    const max = Math.max(1, ...b.points.map((p) => p.value));
    const { y0, left, width, height } = this.axes(top, b.label, String(max), max >= 2 && max % 2 === 0 ? String(max / 2) : "");
    const n = Math.max(1, b.points.length);
    const slot = width / n;
    const bw = Math.min(28, slot - 4);
    b.points.forEach((p, i) => {
      const x = left + i * slot + (slot - bw) / 2;
      const h = (p.value / max) * height;
      if (h > 0) this.page.drawRectangle({ x, y: y0, width: bw, height: h, color: ACCENT });
      if (p.value) this.page.drawText(String(p.value), { x: x + 2, y: y0 + h + 2, size: 6.5, font: this.font, color: INK });
      this.page.drawText(this.fit(safe(p.label), 6, slot), { x, y: y0 - 9, size: 6, font: this.font, color: MUTED });
    });
    this.y = y0 - 20;
  }

  /** A table that only breaks between rows, keeps at least three rows on each side, and repeats its column names. */
  keptTable(rows: Cell[][], keep: string[] | undefined, p: PartOut) {
    for (const block of this.tableBlocks(rows)) {
      const head = block[0];
      const idx = keep ? head.map((h, i) => (keep.includes(String(h)) ? i : -1)).filter((i) => i >= 0) : head.map((_, i) => i);
      const cols = (idx.length ? idx : head.map((_, i) => i)).slice(0, 12);
      const width = this.w - 2 * this.m;
      const weight = cols.map((c) => Math.min(Math.max(safe(head[c]).length * 0.7, ...block.slice(1, 40).map((r) => safe(r[c]).length), 3), 48));
      const total = weight.reduce((a, b) => a + b, 0);
      const widths = weight.map((x) => (x / total) * width);
      const drawRow = (r: Cell[], header: boolean, shade: boolean) => {
        if (header || shade) this.page.drawRectangle({ x: this.m, y: this.y - ROW + 3, width, height: ROW, color: header ? HEAD : rgb(0.985, 0.988, 0.992) });
        let x = this.m;
        cols.forEach((c, i) => {
          const f = header ? this.bold : this.font;
          this.page.drawText(this.fit(safe(r[c]), 8, widths[i] - 6, f), { x: x + 3, y: this.y - ROW + 7, size: 8, font: f, color: header ? MUTED : INK });
          x += widths[i];
        });
        this.y -= ROW;
      };
      const body = block.slice(1);
      // A sub-table that can't fit its header and three rows here starts on the next page.
      if (this.y - ROW * (1 + Math.min(MIN_ROWS, body.length)) < this.bottom) {
        this.newPage();
        this.partHeading(p, true);
      }
      drawRow(head, true, false);
      let i = 0;
      while (i < body.length) {
        const room = Math.floor((this.y - this.bottom) / ROW);
        let take = Math.min(room, body.length - i);
        const left = body.length - i - take;
        // Never leave fewer than three rows for the next page.
        if (left > 0 && left < MIN_ROWS) take = Math.max(0, take - (MIN_ROWS - left));
        for (let j = 0; j < take; j++) drawRow(body[i + j], false, (i + j) % 2 === 1);
        i += take;
        if (i < body.length) {
          this.newPage();
          this.partHeading(p, true);
          drawRow(head, true, false);
        }
      }
      this.y -= 10;
    }
  }

  /** Starts a new page when `need` points won't fit here (and it isn't already the top of a page). */
  ensure(need: number) {
    if (this.y - need < this.bottom && !this.atTop) this.newPage();
  }

  drawPart(p: PartOut) {
    this.partHeading(p);
    for (const b of p.blocks) {
      if (b.k !== "table") this.ensure(this.blockHeight(b));
      this.drawBlock(b, p);
    }
  }
}

/**
 * The report as a PDF: page 1 has its name, filters, date and who made it; then the parts in
 * order. A part that fits on a page is never split; a note stays with the part after it; parts
 * shown side by side stay together; long tables break only between rows.
 */
export async function customReportPdf(name: string, filters: string[], built: BuiltPart[], opts: { preparedBy: string | null; logo: boolean }) {
  const doc = await PDFDocument.create();
  doc.setTitle(name);
  doc.setCreator("Flaw Patrol");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const made = new Date();
  const pdf = new ReportWriter(doc, font, bold, safe(`${name} · made ${made.toISOString().slice(0, 16).replace("T", " ")} UTC with Flaw Patrol`));
  pdf.newPage();

  let left = pdf.m;
  if (opts.logo) {
    const png = await readFile(path.join(process.cwd(), "src/app/icon.png")).catch(() => readFile(path.join(process.cwd(), "public/brand/icon.png")).catch(() => null));
    const img = png && (await doc.embedPng(png).catch(() => null));
    if (img) {
      pdf.page.drawImage(img, { x: pdf.m, y: pdf.y - 40, width: 40, height: 40 });
      left = pdf.m + 52;
    }
  }
  pdf.y -= 22;
  pdf.page.drawText(pdf.fit(safe(name), 22, pdf.w - left - pdf.m, bold), { x: left, y: pdf.y, size: 22, font: bold, color: INK });
  pdf.y -= 16;
  const parts = built.filter((b) => b.kind === "part").length;
  pdf.page.drawText(safe([made.toDateString(), opts.preparedBy && `Prepared by ${opts.preparedBy}`, `${parts} ${parts === 1 ? "part" : "parts"}`].filter(Boolean).join(" · ")), { x: left, y: pdf.y, size: 10, font, color: MUTED });
  pdf.y -= 22;
  for (const line of filters) pdf.text(line, 10, { color: MUTED, gap: 2 });
  pdf.y -= 6;

  const byId = new Map(built.map((b) => [b.item.id, b]));
  const rows = layoutRows(built.map((b) => b.item));
  // A note travels with the row after it.
  const groups: ReportItem[][][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0].k === "note" && rows[i + 1]) {
      groups.push([r, rows[i + 1]]);
      i++;
    } else groups.push([r]);
  }
  const height = (it: ReportItem) => {
    const b = byId.get(it.id)!;
    return b.kind === "note" ? pdf.noteHeight(b.text) : pdf.partHeight(b.out);
  };
  for (const g of groups) {
    const items = g.flat();
    if (items.some((it) => it.pb) && !pdf.atTop) pdf.newPage();
    const whole = items.reduce((n, it) => n + height(it), 0);
    const last = items.at(-1)!;
    const lastB = byId.get(last.id)!;
    // Everything up to the last part's first rows has to fit; a group taller than a page starts at the top.
    const lead = items.slice(0, -1).reduce((n, it) => n + height(it), 0) + (lastB.kind === "note" ? pdf.noteHeight(lastB.text) : pdf.firstHeight(lastB.out.blocks));
    if (whole <= pdf.usable) pdf.ensure(whole);
    else pdf.ensure(Math.min(lead, pdf.usable));
    for (const it of items) {
      const b = byId.get(it.id)!;
      if (b.kind === "note") {
        pdf.ensure(pdf.noteHeight(b.text));
        pdf.note(b.text);
      } else {
        pdf.ensure(Math.min(pdf.partHeight(b.out), pdf.firstHeight(b.out.blocks)));
        pdf.drawPart(b.out);
      }
    }
  }
  return doc.save();
}

// ——— Excel ———

/** The report as a workbook: a first sheet with the filters, the parts in order and the notes, then one sheet per part. */
export async function customReportWorkbook(name: string, filters: string[], built: BuiltPart[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flaw Patrol";
  const info = wb.addWorksheet("Report");
  info.addRows([[name], [`Made ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`], [], ["Filters"], ...filters.map((x) => [x]), [], ["In this report"]]);
  info.getRow(1).font = { bold: true, size: 14 };
  info.getColumn(1).width = 90;
  const used = new Set<string>(["Report"]);
  for (const b of built) {
    if (b.kind === "note") {
      info.addRow([`Note: ${b.text}`]).alignment = { wrapText: true };
      continue;
    }
    info.addRow([`${b.out.heading} (${b.out.from})${b.out.own ? ` · ${b.out.own}` : ""}`]);
    let sheet = b.out.heading.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
    for (let n = 2; used.has(sheet); n++) sheet = `${b.out.heading.replace(/[:\\/?*[\]]/g, " ").slice(0, 27)} ${n}`;
    used.add(sheet);
    const ws = wb.addWorksheet(sheet);
    const bold = (r: ExcelJS.Row) => (r.font = { bold: true });
    for (const blk of b.out.blocks) {
      if (blk.k === "text") ws.addRow([blk.text]);
      else if (blk.k === "tiles") {
        bold(ws.addRow(["", "Value"]));
        for (const t of blk.list) ws.addRow([t.label, t.value]);
      } else if (blk.k === "bar") {
        bold(ws.addRow([blk.label, "Cases"]));
        for (const s of STATUSES) if (blk.counts[s]) ws.addRow([STATUS_LABEL[s], blk.counts[s]]);
      } else if (blk.k === "line") {
        bold(ws.addRow(["", ...blk.series.map((s) => s.name)]));
        (blk.series[0]?.points ?? []).forEach((p, i) => ws.addRow([p.label, ...blk.series.map((s) => (s.points[i]?.value === null || s.points[i]?.value === undefined ? "" : pct(s.points[i].value)))]));
      } else if (blk.k === "columns") {
        bold(ws.addRow(["", blk.label]));
        for (const p of blk.points) ws.addRow([p.label, p.value]);
      } else
        blk.rows.forEach((r, i) => {
          const row = ws.addRow(r);
          if (i === 0 || (r.length && blk.rows[i - 1]?.length === 0)) bold(row);
        });
      ws.addRow([]);
    }
    ws.columns.forEach((c) => {
      let w = 8;
      c.eachCell?.({ includeEmpty: false }, (cell) => (w = Math.max(w, Math.min(60, String(cell.value ?? "").length + 2))));
      c.width = w;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}


