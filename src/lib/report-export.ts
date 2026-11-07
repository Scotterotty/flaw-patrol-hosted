import type { WrapUp } from "./wrap-ups";
import { runTag } from "./run-label";
import { WRAP_HEADING, WRAP_NOTE, wrapLine, wrapUpsRows } from "./wrap-up-text";
import "server-only";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { clock, NOTE_LABEL } from "./charter";
import { parseFindingFilters, sessionFindings } from "./findings";
import { caseKey } from "./format";
import { bugKeys, buildLine, percent, pickRelease, resultLine, stateOf } from "./rc-status";
import { caseHealth, defectReport, runReport, stepHistory, trends, type ReportFilters, type ReportScope, type RunRow } from "./reports";
import { runValues } from "./run-fields";
import { runFieldsFor } from "./run-fields-server";
import { severityScaleFor } from "./severity-server";
import { manualLine, splitProgress } from "./progress-split";
import { countStatuses, pct, STATUS_LABEL, STATUSES, totals, type StatusCounts } from "./status";
import { coverageCsvRows, storyCoverage, storyReleases, type CoverageColumn } from "./story-coverage";
import { listReleases, rcStatus } from "@/server/rc-status";
import { db } from "./db";
import { regressionReport, regressionScope } from "./regression-data";
import { fullDate, madeAt, UTC_CLOCK, type Clock } from "./spelling";

// One Export menu on every Reports page: each tab as CSV, copy or image, and the
// whole report as an Excel workbook (one sheet per tab) or a PDF made here on the server.

export type Cell = string | number | null;
export type Table = { label: string; rows: Cell[][]; note?: string };

/** Every tab the export can make, in the order the Reports page shows them. */
export const EXPORT_TABS = [
  { id: "rc", label: "Release status summary" },
  { id: "status", label: "Execution status" },
  { id: "trends", label: "Trends" },
  { id: "steps", label: "Step results" },
  { id: "failing", label: "Failing steps" },
  { id: "regression", label: "Regression" },
  { id: "defects", label: "Bugs found" },
  { id: "cases", label: "Case history" },
  { id: "requirements", label: "Requirements coverage" },
  { id: "findings", label: "Session findings" },
] as const;
export type ExportTab = (typeof EXPORT_TABS)[number]["id"];

/** Where the report comes from: a test cycle, or an umbrella (maybe narrowed to a platform). */
export type ExportCtx = {
  scope: ReportScope;
  /** The project whose run fields and severity names apply (the cycle, or the umbrella's hub). */
  homeId: string;
  umbrella: boolean;
  /** "Acme Checkout" or "Acme Checkout Web 2.4.0". */
  title: string;
  /** The filters in words, for page 1 and the Filters sheet. */
  filters: string[];
  viewer: { id: string; isAdmin: boolean };
  /** Requirements coverage: the columns the page shows. */
  coverage: { libraryIds: string[]; columns: CoverageColumn[]; rcNames: string[] };
  /** Session findings are a test cycle's own tab. */
  projectKey?: string;
  query: Record<string, string | undefined>;
  /** Wrap-ups attached to the report: their own sheet and section, outside pass rates. */
  wrapUps?: WrapUp[];
};

const RUN_TYPE = { manual: "Manual", upload: "Automated (uploaded)", github: "Automated (GitHub)" } as const;
/** The run's version (or start day), with its test cycle in an umbrella (ver_189: never "R12"). */
const runName = (ctx: ExportCtx, r: Pick<RunRow, "projectKey" | "name" | "build" | "createdAt">) => [ctx.umbrella ? r.projectKey : "", runTag(r) || r.name].filter(Boolean).join(" ");
export const outcomes = (c: StatusCounts) => STATUSES.filter((s) => c[s]).map((s) => `${c[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(", ");

/** One tab as a table: header row first. Tabs that don't apply give null. */
export async function reportTable(ctx: ExportCtx, view: ExportTab, f: ReportFilters): Promise<Table | null> {
  const label = EXPORT_TABS.find((t) => t.id === view)?.label ?? view;
  const scope = ctx.scope;
  if (view === "trends") {
    const t = await trends(scope, f);
    return {
      label,
      rows: [
        ["Period starting", "Passed", "Failed", "Blocked", "Retest", "Skipped", "Pass rate", "Bugs found"],
        ...t.buckets.map((b) => [b.key, b.counts.PASSED, b.counts.FAILED, b.counts.BLOCKED, b.counts.RETEST, b.counts.SKIPPED, pct(b.passRate), b.bugs]),
        [],
        ["Release", "Runs", "Passed", "Failed", "Blocked", "Retest", "Skipped", "Pass rate", "Bugs found"],
        ...t.releases.map((r) => [r.release, r.runs, r.counts.PASSED, r.counts.FAILED, r.counts.BLOCKED, r.counts.RETEST, r.counts.SKIPPED, pct(r.passRate), r.bugs]),
      ],
    };
  }
  if (view === "regression") {
    const home = await db.project.findUnique({ where: { id: ctx.homeId }, select: { id: true, groupId: true, platform: true } });
    const ids = ctx.umbrella ? (Array.isArray(scope) ? scope : [scope]) : home ? await regressionScope(home) : [ctx.homeId];
    const r = await regressionReport(ids, { rc: ctx.query.rc, vs: ctx.query.vs, platform: ctx.umbrella ? ctx.query.platform : home?.platform || undefined });
    return {
      label: r.newer && r.older ? `${label} · ${r.newer} vs ${r.older}` : label,
      rows: [["Case", "Title", "Platform", "Last passed", "Broke in", "Now", "Bug", "Automated"], ...r.rows.map((x) => [x.caseKey, x.title, x.platform, x.lastPassed, x.brokeIn, x.now === "still" ? "Still broken" : "Fixed again", x.bug?.key ?? "", x.automated ? "Yes" : ""])],
    };
  }
  if (view === "steps") {
    const runs = await runReport(scope, f);
    return {
      label,
      rows: [
        ["Run", "Name", "Type", "Release", "Passed steps", "Failed steps", "Blocked steps", "Skipped steps", "Untested steps"],
        ...runs.map((r) => [runName(ctx, r), r.name, RUN_TYPE[r.source], r.release, r.steps.PASSED, r.steps.FAILED, r.steps.BLOCKED, r.steps.SKIPPED, r.steps.UNTESTED]),
      ],
    };
  }
  if (view === "failing") {
    const steps = (await stepHistory(scope, f)).filter((s) => s.failures > 0);
    return {
      label,
      rows: [
        ["Case", "Title", "Step", "Action", "Times run", "Failures", "Failed", "Blocked", "Fail rate", "Failing in a row", "Last failed run", "Last failed release", "Last failed at", "Bugs", "History (oldest first)"],
        ...steps.map((s) => [
          s.caseKey,
          s.title,
          s.step,
          s.action,
          s.runs,
          s.failures,
          s.failed,
          s.blocked,
          pct(s.failRate),
          s.streak,
          s.lastFailed ? (ctx.umbrella ? `${s.lastFailed.projectKey} ${s.lastFailed.label}` : s.lastFailed.label) : "",
          s.lastFailed?.release ?? "",
          s.lastFailed?.at.toISOString() ?? "",
          s.bugs.join(", "),
          s.history.map((h) => `${h.label} ${STATUS_LABEL[h.status].toLowerCase()}`).join("; "),
        ]),
      ],
    };
  }
  if (view === "defects") {
    const [d, scale] = await Promise.all([defectReport(scope, f), severityScaleFor(ctx.homeId)]);
    return {
      label,
      rows: [
        ["Bug", "Title", "Status", "Severity", "Found in", "Link", "Reported"],
        ...d.map((x) => [
          x.key,
          x.title,
          x.status,
          scale.labels[x.severity as keyof typeof scale.labels] ?? x.severity,
          x.foundIn.map((i) => `${i.caseKey}${i.step !== null ? ` step ${i.step}` : ""} ${i.label}${i.release ? ` ${i.release}` : ""}`).join("; "),
          x.url,
          x.createdAt.toISOString(),
        ]),
      ],
    };
  }
  if (view === "cases") {
    const c = await caseHealth(scope, f);
    return {
      label,
      rows: [
        ["Case", "Title", "Tags", "Executions", "Pass rate", "Latest result", "Latest at", "Failed in a row", "Pass/fail flips"],
        ...c.map((x) => [x.caseKey, x.title, x.tags.join(", "), x.runs, pct(x.passRate), STATUS_LABEL[x.last], x.lastAt.toISOString(), x.failStreak, x.flips]),
      ],
    };
  }
  if (view === "findings") {
    if (!ctx.projectKey || Array.isArray(scope)) return null;
    const { groups } = await sessionFindings(scope, f, parseFindingFilters(ctx.query));
    const key = ctx.projectKey;
    return {
      label,
      rows: [
        ["Charter", "Title", "Persona", "Type", "Finding", "Bug", "Tester", "Run", "Release", "Time into session", "Saved", "Answer", "Answered by"],
        ...groups.flatMap((g) =>
          g.items.map((i) => [
            caseKey(key, g.number),
            g.title,
            g.persona?.name ?? "",
            NOTE_LABEL[i.note.kind],
            i.note.text,
            i.note.defect ? (i.note.defect.externalKey ?? `D-${i.note.defect.number}`) : "",
            i.tester,
            i.runLabel,
            i.release,
            clock(i.note.at),
            i.at.toISOString(),
            i.answer?.text ?? "",
            i.answer?.by ?? "",
          ]),
        ),
      ],
    };
  }
  if (view === "rc") {
    const rc = await rcTable(ctx, f);
    return rc && { label: `${label} · ${rc.release}`, rows: rc.rows };
  }
  if (view === "requirements") {
    try {
      const all = await storyReleases(ctx.homeId);
      const release = pickRelease(all, f.release, ctx.coverage.rcNames);
      const cov = await storyCoverage({ projectId: ctx.homeId, libraryIds: ctx.coverage.libraryIds, columns: ctx.coverage.columns, release });
      if (!cov.connected) return { label, rows: [["Requirements come from Jira, and Jira isn't connected."]] };
      return { label: `${label} · ${release ?? "all linked requirements"}`, rows: coverageCsvRows(ctx.coverage.columns, cov.rows) };
    } catch (e) {
      return { label, rows: [[`Couldn't read requirements from Jira: ${e instanceof Error ? e.message : "unknown error"}`]] };
    }
  }
  // Execution status: one row per run.
  const runs = await runReport(scope, f);
  const defs = await runFieldsFor(ctx.homeId);
  // One column per run field, plus any a run still has after it was removed.
  const cols = [...defs.map((d) => ({ id: d.id, name: d.name }))];
  for (const r of runs) for (const v of runValues(r, defs)) if (!cols.some((c) => c.id === v.id)) cols.push({ id: v.id, name: v.name });
  return {
    label,
    rows: [
      ["Run", "Name", ...(ctx.umbrella ? ["Test cycle", "Platform"] : []), "Type", "Suite", "Suite version", "Release", "Version", ...cols.map((c) => c.name), "Started", "State", "Cases", "Tested", "Passed", "Failed", "Blocked", "Retest", "Skipped", "In progress", "Untested", "Pass rate", "Bugs"],
      ...runs.map((r) => {
        const t = totals(r.counts);
        const vals = runValues(r, defs);
        return [
          runName(ctx, r),
          r.name,
          ...(ctx.umbrella ? [r.projectName, r.platform] : []),
          RUN_TYPE[r.source],
          r.suite,
          r.suiteVersion,
          r.release,
          r.build,
          ...cols.map((c) => vals.find((v) => v.id === c.id)?.value ?? ""),
          r.createdAt.toISOString(),
          r.state,
          t.total,
          t.tested,
          r.counts.PASSED,
          r.counts.FAILED,
          r.counts.BLOCKED,
          r.counts.RETEST,
          r.counts.SKIPPED,
          r.counts.IN_PROGRESS,
          r.counts.UNTESTED,
          pct(t.passRate),
          r.defects,
        ];
      }),
    ],
  };
}

/** Release status for the picked release, or the newest one. */
export async function rcTable(ctx: ExportCtx, f: ReportFilters) {
  const projectIds = Array.isArray(ctx.scope) ? ctx.scope : [ctx.scope];
  const scope = { projectIds, addAnywhere: false };
  const release = f.release || (await listReleases(ctx.viewer, scope))[0];
  if (!release) return null;
  const { columns, bugs, scale } = await rcStatus(ctx.viewer, release, { hide: [], add: [] }, scope);
  if (!columns.length) return null;
  return {
    release,
    columns,
    bugs,
    scale,
    rows: [
      ["Platform", "Build", "State", "Done", "Cases run", "Cases", "Results", "Bugs", "Regressions"],
      ...columns.map((c) => [c.label, buildLine(release, c), stateOf(c).label, `${percent(c)}%`, c.done, c.total, resultLine(c), bugKeys(c), c.regressions ? `${c.regressions.count} (${c.regressions.keys.join(", ")})` : ""]),
      ...(bugs.length
        ? [[], ["Critical and blocking bugs", "Title", "Severity", "Priority", "Jira status", "Platforms", "Cases"], ...bugs.map((b) => [b.key, b.title, scale.labels[b.severity], b.priority, b.status, b.clients.join(", "), b.cases.length])]
        : []),
    ] as Cell[][],
  };
}

/** Whole report as a workbook: one sheet per tab, plus one listing the filters. */
export async function reportWorkbook(ctx: ExportCtx, f: ReportFilters, tabs: ExportTab[], clock: Clock = UTC_CLOCK) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flaw Patrol";
  const info = wb.addWorksheet("Filters");
  info.addRows([[`${ctx.title} report`], [`Made ${madeAt(new Date(), clock.spelling, clock.zone)}`], [], ["Filters"], ...ctx.filters.map((x) => [x])]);
  info.getRow(1).font = { bold: true, size: 14 };
  info.getColumn(1).width = 60;
  const used = new Set<string>(["Filters"]);
  for (const id of tabs) {
    const t = await reportTable(ctx, id, f);
    if (!t) continue;
    // Sheet names: 31 characters, unique, none of : \ / ? * [ ].
    let name = t.label.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
    for (let n = 2; used.has(name); n++) name = `${t.label.slice(0, 27)} ${n}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    if (t.note) ws.addRow([t.note]);
    t.rows.forEach((r, i) => {
      const row = ws.addRow(r);
      if (i === 0 || (r.length && t.rows[i - 1]?.length === 0)) row.font = { bold: true };
    });
    ws.columns.forEach((c) => {
      let w = 8;
      c.eachCell?.({ includeEmpty: false }, (cell) => (w = Math.max(w, Math.min(60, String(cell.value ?? "").length + 2))));
      c.width = w;
    });
    ws.views = [{ state: "frozen", ySplit: t.note ? 2 : 1 }];
  }
  if (ctx.wrapUps?.length) {
    const ws = wb.addWorksheet("Exploring and bug bashes");
    wrapUpsRows(ctx.wrapUps).forEach((r, i) => {
      const row = ws.addRow(r);
      if (i === 0) row.font = { bold: true };
    });
    ws.columns.forEach((c) => (c.width = 18));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ——— PDF ———

export const INK = rgb(0.06, 0.09, 0.16);
export const MUTED = rgb(0.39, 0.45, 0.55);
export const LINE = rgb(0.89, 0.91, 0.94);
export const HEAD = rgb(0.95, 0.96, 0.98);
export const ACCENT = rgb(0.43, 0.27, 0.78);
export const STATUS_RGB: Partial<Record<keyof StatusCounts, ReturnType<typeof rgb>>> = {
  PASSED: rgb(0.06, 0.6, 0.35),
  FAILED: rgb(0.86, 0.15, 0.15),
  BLOCKED: rgb(0.39, 0.45, 0.55),
  RETEST: rgb(0.55, 0.36, 0.96),
  SKIPPED: rgb(0.8, 0.84, 0.88),
  IN_PROGRESS: rgb(0.23, 0.51, 0.96),
  UNTESTED: rgb(0.89, 0.91, 0.94),
};

/** Which columns each tab keeps in the PDF, so tables fit a page. */
export const PDF_COLS: Partial<Record<ExportTab, string[]>> = {
  status: ["Run", "Name", "Test cycle", "Release", "State", "Cases", "Passed", "Failed", "Blocked", "Pass rate", "Bugs"],
  steps: ["Run", "Name", "Release", "Passed steps", "Failed steps", "Blocked steps", "Skipped steps"],
  failing: ["Case", "Title", "Step", "Times run", "Failures", "Fail rate", "Failing in a row", "Last failed release"],
  defects: ["Bug", "Title", "Status", "Severity", "Found in"],
  cases: ["Case", "Title", "Executions", "Pass rate", "Latest result", "Failed in a row"],
  findings: ["Charter", "Type", "Finding", "Bug", "Tester", "Run"],
};

/** Latin-1 only: the standard PDF fonts can't draw anything else. */
export const safe = (s: Cell) =>
  String(s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "·")
    .replace(/[^\x20-\x7e -ÿ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export class PdfWriter {
  page!: PDFPage;
  y = 0;
  readonly w = 842;
  readonly h = 595;
  readonly m = 36;
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly footer: string,
  ) {}
  newPage() {
    this.page = this.doc.addPage([this.w, this.h]);
    this.y = this.h - this.m;
    this.page.drawText(this.footer, { x: this.m, y: 18, size: 7.5, font: this.font, color: MUTED });
    this.page.drawText(`Page ${this.doc.getPageCount()}`, { x: this.w - this.m - 40, y: 18, size: 7.5, font: this.font, color: MUTED });
  }
  room(h: number) {
    if (this.y - h < this.m + 10) this.newPage();
  }
  fit(text: string, size: number, max: number, f = this.font) {
    let t = text;
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, size) > max) t = t.slice(0, -1);
    return `${t}...`;
  }
  text(s: string, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}) {
    this.room(size + 4);
    this.y -= size;
    this.page.drawText(this.fit(safe(s), size, this.w - 2 * this.m, opts.bold ? this.bold : this.font), { x: opts.x ?? this.m, y: this.y, size, font: opts.bold ? this.bold : this.font, color: opts.color ?? INK });
    this.y -= opts.gap ?? 4;
  }
  heading(s: string) {
    this.room(60);
    this.y -= 8;
    this.text(s, 14, { bold: true, gap: 6 });
    this.page.drawLine({ start: { x: this.m, y: this.y }, end: { x: this.w - this.m, y: this.y }, thickness: 1, color: ACCENT });
    this.y -= 10;
  }
  /** A stacked bar of result counts, with a legend under it. */
  bar(counts: StatusCounts, label: string) {
    const total = STATUSES.reduce((n, s) => n + counts[s], 0);
    if (!total) return;
    this.room(46);
    this.text(label, 9, { color: MUTED });
    const width = this.w - 2 * this.m;
    let x = this.m;
    this.y -= 12;
    for (const s of STATUSES) {
      if (!counts[s]) continue;
      const wd = (counts[s] / total) * width;
      this.page.drawRectangle({ x, y: this.y, width: wd, height: 12, color: STATUS_RGB[s] ?? LINE });
      x += wd;
    }
    this.y -= 4;
    this.text(outcomes(counts), 8.5, { color: MUTED, gap: 8 });
  }
  /** Big numbers in a row, like the tiles on the page. */
  tiles(list: { label: string; value: string }[]) {
    this.room(48);
    const wd = (this.w - 2 * this.m - 10 * (list.length - 1)) / list.length;
    const top = this.y;
    list.forEach((t, i) => {
      const x = this.m + i * (wd + 10);
      this.page.drawRectangle({ x, y: top - 42, width: wd, height: 42, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1) });
      this.page.drawText(this.fit(safe(t.label), 8, wd - 16), { x: x + 8, y: top - 14, size: 8, font: this.font, color: MUTED });
      this.page.drawText(this.fit(safe(t.value), 16, wd - 16, this.bold), { x: x + 8, y: top - 34, size: 16, font: this.bold, color: INK });
    });
    this.y = top - 52;
  }
  table(rows: Cell[][], keep?: string[]) {
    const blocks: Cell[][][] = [[]];
    for (const r of rows) {
      if (!r.length) blocks.push([]);
      else blocks.at(-1)!.push(r);
    }
    for (const block of blocks.filter((b) => b.length)) {
      const head = block[0];
      const idx = keep ? head.map((h, i) => (keep.includes(String(h)) ? i : -1)).filter((i) => i >= 0) : head.map((_, i) => i);
      const cols = (idx.length ? idx : head.map((_, i) => i)).slice(0, 12);
      const width = this.w - 2 * this.m;
      // Wider columns for words, narrower for numbers.
      const weight = cols.map((c) => {
        const sample = block.slice(1, 40).map((r) => safe(r[c]).length);
        const longest = Math.max(safe(head[c]).length * 0.7, ...sample, 3);
        return Math.min(longest, 48);
      });
      const sum = weight.reduce((a, b) => a + b, 0);
      const widths = weight.map((x) => (x / sum) * width);
      const size = 8;
      const rowH = 14;
      const drawRow = (r: Cell[], header: boolean, shade: boolean) => {
        this.room(rowH + 2);
        if (header || shade) this.page.drawRectangle({ x: this.m, y: this.y - rowH + 3, width, height: rowH, color: header ? HEAD : rgb(0.985, 0.988, 0.992) });
        let x = this.m;
        cols.forEach((c, i) => {
          const f = header ? this.bold : this.font;
          this.page.drawText(this.fit(safe(r[c]), size, widths[i] - 6, f), { x: x + 3, y: this.y - rowH + 7, size, font: f, color: header ? MUTED : INK });
          x += widths[i];
        });
        this.y -= rowH;
      };
      drawRow(head, true, false);
      block.slice(1).forEach((r, i) => {
        // Repeat the header on each new page.
        if (this.y - rowH < this.m + 10) {
          this.newPage();
          drawRow(head, true, false);
        }
        drawRow(r, false, i % 2 === 1);
      });
      this.y -= 10;
    }
  }
}

/** The whole report as a PDF: page 1 has the filters, date and Release status; then each tab picked. */
export async function reportPdf(ctx: ExportCtx, f: ReportFilters, tabs: ExportTab[], opts: { preparedBy: string | null; logo: boolean; clock?: Clock }) {
  const clock = opts.clock ?? UTC_CLOCK;
  const doc = await PDFDocument.create();
  doc.setTitle(`${ctx.title} report`);
  doc.setCreator("Flaw Patrol");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const made = new Date();
  const pdf = new PdfWriter(doc, font, bold, safe(`${ctx.title} report · made ${madeAt(made, clock.spelling, clock.zone)} with Flaw Patrol`));
  pdf.newPage();

  // Page 1: who, what and when.
  let left = pdf.m;
  if (opts.logo) {
    const png = await readFile(path.join(process.cwd(), "src/app/icon.png")).catch(() => readFile(path.join(process.cwd(), "public/brand/icon.png")).catch(() => null));
    if (png) {
      const img = await doc.embedPng(png).catch(() => null);
      if (img) {
        pdf.page.drawImage(img, { x: pdf.m, y: pdf.y - 40, width: 40, height: 40 });
        left = pdf.m + 52;
      }
    }
  }
  pdf.y -= 22;
  pdf.page.drawText(pdf.fit(safe(`${ctx.title} report`), 22, pdf.w - left - pdf.m, bold), { x: left, y: pdf.y, size: 22, font: bold, color: INK });
  pdf.y -= 16;
  pdf.page.drawText(safe([fullDate(made, clock.spelling, clock.zone), opts.preparedBy && `Prepared by ${opts.preparedBy}`].filter(Boolean).join(" · ")), { x: left, y: pdf.y, size: 10, font, color: MUTED });
  pdf.y -= 22;
  for (const line of ctx.filters) pdf.text(line, 10, { color: MUTED, gap: 2 });
  pdf.y -= 6;

  for (const id of tabs) {
    if (id === "rc") {
      const rc = await rcTable(ctx, f);
      pdf.heading(`Release status · ${rc?.release ?? "no release yet"}`);
      if (!rc) {
        pdf.text("No runs have a release set. Set one on a run to group results by release.", 10, { color: MUTED });
        continue;
      }
      pdf.tiles(rc.columns.slice(0, 6).map((c) => ({ label: `${c.label} · ${stateOf(c).label}`, value: `${percent(c)}%` })));
      pdf.table(rc.rows);
      continue;
    }
    if (id === "status" || id === "steps") {
      const runs = await runReport(ctx.scope, f);
      const counts = countStatuses(runs.flatMap((r) => STATUSES.flatMap((s) => Array(id === "status" ? r.counts[s] : r.steps[s]).fill(s))));
      const t = totals(counts);
      pdf.heading(EXPORT_TABS.find((x) => x.id === id)!.label);
      // Hand testing and automation are never added together.
      const { manual, auto } = splitProgress(runs);
      const hand = manualLine(manual);
      pdf.tiles(
        id === "status"
          ? [
              { label: manual.runs && auto.runs ? `Runs (${manual.runs} manual, ${auto.runs} automated)` : "Runs", value: String(runs.length) },
              ...(manual.runs ? [{ label: manual.inProgress ? `Manual: finished (${manual.inProgress} in progress)` : "Manual: tested by hand", value: `${hand.tested} of ${hand.total}` }] : []),
              ...(auto.runs ? [{ label: "Automated: passed on latest run", value: `${auto.latest.PASSED} of ${auto.cases}` }] : []),
              { label: "Bugs found", value: String(manual.bugs + auto.bugs) },
            ]
          : [
              { label: "Steps executed", value: String(t.tested) },
              { label: "Pass rate", value: pct(t.passRate) },
              { label: "Failed", value: String(counts.FAILED) },
              { label: "Blocked", value: String(counts.BLOCKED) },
            ],
      );
      if (id === "status") {
        if (manual.runs) pdf.bar(manual.counts, "Manual testing: cases by result");
        if (auto.runs) pdf.bar(auto.latest, "Automated tests: latest result of each case");
      } else pdf.bar(counts, "Steps by result");
    } else pdf.heading(EXPORT_TABS.find((x) => x.id === id)?.label ?? id);
    const table = await reportTable(ctx, id, f);
    if (!table) {
      pdf.text("Not available here.", 10, { color: MUTED });
      continue;
    }
    if (table.note) pdf.text(table.note, 9, { color: MUTED });
    if (table.rows.length <= 1) {
      pdf.text("Nothing in this range.", 10, { color: MUTED });
      continue;
    }
    if (id === "trends") {
      // A bar per period: pass rate, as on the Trends tab.
      const t = await trends(ctx.scope, f);
      const buckets = t.buckets.filter((b) => b.passRate !== null).slice(-24);
      if (buckets.length) {
        pdf.room(110);
        pdf.text("Pass rate by period", 9, { color: MUTED });
        const width = pdf.w - 2 * pdf.m;
        const bw = Math.min(28, width / buckets.length - 4);
        const base = pdf.y - 80;
        pdf.page.drawLine({ start: { x: pdf.m, y: base }, end: { x: pdf.m + width, y: base }, thickness: 0.5, color: LINE });
        buckets.forEach((b, i) => {
          const x = pdf.m + i * (bw + 4);
          const h = (b.passRate ?? 0) * 70;
          pdf.page.drawRectangle({ x, y: base, width: bw, height: Math.max(1, h), color: ACCENT });
          pdf.page.drawText(pdf.fit(safe(b.label), 6, bw + 2), { x, y: base - 9, size: 6, font, color: MUTED });
        });
        pdf.y = base - 18;
      }
    }
    pdf.table(table.rows, PDF_COLS[id]);
  }
  if (ctx.wrapUps?.length) {
    pdf.heading(`${WRAP_HEADING} · ${WRAP_NOTE}`);
    for (const w of ctx.wrapUps) {
      pdf.text(safe(`${w.title} (${w.type === "bash" ? "Bug bash" : "Exploratory"})`), 10);
      pdf.text(safe(wrapLine(w).replace(/[^\x20-\x7E·]/g, "").trim()), 9, { color: MUTED });
      if (w.summary) pdf.text(safe(`"${w.summary}"`), 9, { color: MUTED });
    }
  }
  return doc.save();
}
