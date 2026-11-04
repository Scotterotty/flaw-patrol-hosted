import "server-only";

import type { ResultStatus } from "@prisma/client";
import { after } from "next/server";
import { db } from "@/lib/db";
import { SHEETS_ENABLED } from "@/lib/features";
import { caseKey, PRIORITY_LABEL } from "@/lib/format";
import { parseDraft } from "@/lib/run-draft";
import { findLayout, matchEntries, parseFillConfig, planCells, type FillConfig, type FillEntry, type SheetGrid } from "@/lib/sheet-fill";
import { STATUS_CHIPS, TESTER_CHIP } from "@/lib/sheet-colors";
import { STATUS_LABEL } from "@/lib/status";
import type { ExpandedStep } from "@/lib/steps";

// Mirrors a run into a tab of a Google Sheet, one row per step, laid out like
// the team's own cycle sheets. The sheet holds a small script (see
// sheetScript) that we post the whole tab to; the tab is rewritten each time,
// so a missed push fixes itself on the next one.

export const SHEET_HEADER = ["Key", "Name", "Description", "Precondition", "Step Order", "Step Description", "Expected Result", "", "Executed By", "Status", "Defects", "Priority", "Folder"];
const CASE_STATUS_COL = 8; // H: the case's status, under a header showing how much of the run is done
const EXECUTED_BY_COL = 9;
const STEP_STATUS_COL = 10;

// The look of the team's R22 cycle sheet, taken from its .xlsx: a dark blue
// header in Montserrat, Calibri body text, rows striped white then gray down
// the whole tab, the case status and tester merged down each case, a thick
// line under each case, and Description and Precondition hidden.
export const SHEET_LOOK = {
  header: "#1C4587",
  headerText: "#F3F3F3",
  headerFont: "Montserrat",
  headerSize: 13,
  font: "Calibri",
  statusFont: "Montserrat",
  size: 11,
  band: "#EBEFF1",
  text: "#000000",
  // Excel character widths, as in the sheet.
  widths: [8.6, 22.8, 19.5, 20.6, 11, 40.9, 37.4, 16.9, 19.8, 14.5, 17.1, 17.1, 21.4],
  hidden: [3, 4],
  frozenColumns: 6,
  centered: [CASE_STATUS_COL, EXECUTED_BY_COL, STEP_STATUS_COL],
  // Only the long-text columns wrap.
  wrapped: [1, 2, 3, 4, 6, 7, 11, 13],
};
/** The sheet's own words for each status ("In Progress", "Not Run"). */
export const SHEET_STATUS: Record<ResultStatus, string> = { ...STATUS_LABEL, IN_PROGRESS: "In Progress", SKIPPED: "Not Run", EXPLORED: "Explored" };
/** The case status dropdown, in the sheet's order. */
export const SHEET_CASE_STATUSES = ["Untested", "In Progress", "Passed", "Failed", "Blocked", "Not Run"];
// Statuses that count as run in the header's percentage, the same rule as the app (Skipped is "Not Run" here).
// "Defective" stays so older sheets that still use it keep their percentage (ver_94 dropped it from the app).
const DONE_STATUSES = ["Passed", "Defective", "Failed", "Blocked", "Not Run"];
/** The live percentage over the case status column: cases with a result ÷ all cases. */
export const doneFormula = (lastRow: number) =>
  `SUMPRODUCT(COUNTIF(H2:H${lastRow},{${DONE_STATUSES.map((s) => `"${s}"`).join(",")}}))/MAX(1,COUNTIF(H2:H${lastRow},"<>"))`;
/** Background and text color for each body cell, row by row. Statuses get theirs from STATUS_CHIPS rules. */
export function sheetColors(rows: string[][]) {
  // Sheet rows 2, 4, 6… are white and 3, 5, 7… gray, carrying on across cases.
  const backgrounds = rows.map((row, i) => row.map(() => (i % 2 === 0 ? "#FFFFFF" : SHEET_LOOK.band)));
  const fontColors = rows.map((row) => row.map(() => SHEET_LOOK.text));
  return { backgrounds, fontColors };
}

/** Where a sheet's script lives. Anything else is refused, so the app never posts elsewhere. */
export function validSheetHook(url: string): boolean {
  if (/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return true;
  // Tests post to a local stand-in.
  return process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url);
}

// A cell starting with these would be read as a formula.
const cell = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v);

export async function buildRunSheet(runId: string) {
  const run = await db.testRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      project: { select: { key: true } },
      entries: {
        orderBy: { position: "asc" },
        include: {
          testCase: { select: { number: true, sourceKey: true, project: { select: { key: true } } } },
          results: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { stepResults: true, testerName: true, defects: { select: { stepIndex: true, defect: { select: { number: true, externalKey: true } } } } },
          },
        },
      },
    },
  });

  const rows: string[][] = [];
  const merges: [number, number, number][] = [];
  const caseEnds: number[] = [];
  let done = 0;
  for (const e of run.entries) {
    const steps = (Array.isArray(e.steps) ? e.steps : []) as unknown as ExpandedStep[];
    const last = e.results[0];
    const draft = e.status === "IN_PROGRESS" ? parseDraft(e.draft) : null;
    const stepStatus = (i: number): ResultStatus => {
      const from = draft ? draft.stepResults : ((last?.stepResults ?? []) as { status: ResultStatus }[]);
      return from[i]?.status ?? "UNTESTED";
    };
    const bugs = new Map<number | null, string[]>();
    const addBug = (at: number | null, d: { number: number; externalKey: string | null }) => {
      const key = d.externalKey ?? `D-${d.number}`;
      const list = bugs.get(at) ?? [];
      if (!list.includes(key)) list.push(key);
      bugs.set(at, list);
    };
    for (const l of draft ? draft.defects : (last?.defects ?? [])) addBug(l.stepIndex, l.defect);
    if (DONE_STATUSES.includes(SHEET_STATUS[e.status])) done++;

    const by = (draft ? e.draftByName : last?.testerName) || "—";
    const first = rows.length + 2; // sheet row of this case's first step, after the header
    const count = Math.max(steps.length, 1);
    for (let i = 0; i < count; i++) {
      const s = steps[i];
      const atStep = s ? (bugs.get(i) ?? []) : [];
      const caseBugs = i === 0 ? (bugs.get(null) ?? []) : [];
      rows.push(
        [
          i === 0 ? (e.testCase.sourceKey ?? caseKey(e.testCase.project.key, e.testCase.number)) : "",
          i === 0 ? e.title : "",
          "",
          i === 0 ? e.preconditions : "",
          s?.number ?? "",
          s?.action ?? "",
          s?.expected ?? "",
          i === 0 ? SHEET_STATUS[e.status] : "",
          i === 0 ? by : "",
          s ? SHEET_STATUS[stepStatus(i)] : "",
          [...caseBugs, ...atStep].join(", "),
          i === 0 ? PRIORITY_LABEL[e.priority] : "",
          i === 0 ? e.folderPath : "",
        ],
      );
    }
    if (count > 1) merges.push([first, CASE_STATUS_COL, count], [first, EXECUTED_BY_COL, count]);
    caseEnds.push(first + count - 1);
  }
  const header = [...SHEET_HEADER];
  const total = run.entries.length;
  header[CASE_STATUS_COL - 1] = `${total ? ((done / total) * 100).toFixed(2) : "0.00"}%`;
  // Rows where a case starts, for the case status and tester dropdowns.
  const caseStarts = caseEnds.map((_, i) => (i === 0 ? 2 : caseEnds[i - 1] + 1));
  const members = await db.projectMember.findMany({ where: { projectId: run.projectId }, select: { user: { select: { name: true, email: true } } } });
  const names = [...new Set([...members.map((m) => m.user.name || m.user.email), ...rows.map((r) => r[EXECUTED_BY_COL - 1]).filter((n) => n && n !== "—")])].sort((a, b) => a.localeCompare(b));
  return { name: run.name, header, rows, merges, caseEnds, caseStarts, testers: ["—", ...names] };
}

type SheetReply = { ok?: boolean; error?: string; url?: string; version?: number; values?: string[][]; lists?: (string[] | null)[]; filled?: number; kept?: number };

/** Posts to the sheet's script and returns its answer, or throws an error in plain words. */
async function callSheet(hook: string, body: Record<string, unknown>): Promise<SheetReply> {
  if (!validSheetHook(hook)) throw new Error("That isn't a Google Sheets script address.");
  let res: Response;
  try {
    res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Error(e instanceof Error && e.name === "TimeoutError" ? "Google took too long to answer." : "Couldn't reach the sheet.");
  }
  const text = await res.text();
  let reply: SheetReply;
  try {
    reply = JSON.parse(text);
  } catch {
    // Google answers with a sign-in page when the web app isn't open to "Anyone", and an error page when an older script gets a request it doesn't know.
    throw new Error(
      res.ok
        ? body.action
          ? "The sheet's script didn't answer. Copy the script from Flaw Patrol again (it changed), deploy a new version, and check \"Who has access\" is set to Anyone."
          : "The sheet's script didn't answer. In Apps Script, check the deployment's \"Who has access\" is set to Anyone."
        : `Google answered ${res.status}.`,
    );
  }
  if (!reply.ok) throw new Error(reply.error ?? "The sheet's script refused the update.");
  if (body.action && reply.version !== 2) throw new Error("This sheet has an older Flaw Patrol script. Copy the script again, paste it over the old one, and deploy a new version.");
  return reply;
}

/** The tab's words and dropdowns, read by the sheet's script. */
export async function readSheet(hook: string, secret: string, tab: string): Promise<SheetGrid> {
  const reply = await callSheet(hook, { secret, action: "read", tab });
  return { values: reply.values ?? [], lists: reply.lists ?? [] };
}

/** Each case of the run as "Fill in my columns" needs it: status, tester, step statuses, bugs and the tester's note. */
export async function fillEntries(runId: string): Promise<FillEntry[]> {
  const run = await db.testRun.findUniqueOrThrow({
    where: { id: runId },
    select: {
      entries: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          steps: true,
          draft: true,
          draftByName: true,
          testCase: { select: { number: true, sourceKey: true, project: { select: { key: true } } } },
          results: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { stepResults: true, testerName: true, comment: true, defects: { select: { defect: { select: { number: true, title: true, externalKey: true, externalUrl: true } } } } },
          },
        },
      },
    },
  });
  return run.entries.map((e) => {
    const steps = (Array.isArray(e.steps) ? e.steps : []) as unknown as ExpandedStep[];
    const last = e.results[0];
    const draft = e.status === "IN_PROGRESS" ? parseDraft(e.draft) : null;
    const from = draft ? draft.stepResults : ((last?.stepResults ?? []) as { status: ResultStatus }[]);
    const bugs = new Map<string, { key: string; url: string | null; title: string }>();
    for (const l of draft ? draft.defects : (last?.defects ?? [])) {
      const key = l.defect.externalKey ?? `D-${l.defect.number}`;
      bugs.set(key, { key, url: l.defect.externalUrl ?? null, title: l.defect.title });
    }
    const keys = [caseKey(e.testCase.project.key, e.testCase.number)];
    if (e.testCase.sourceKey) keys.unshift(e.testCase.sourceKey);
    return {
      id: e.id,
      keys,
      title: e.title,
      status: e.status,
      tester: (draft ? e.draftByName : last?.testerName) || "",
      steps: steps.map((st, i) => ({ number: st.number ?? "", status: (from[i]?.status ?? "UNTESTED") as ResultStatus })),
      bugs: [...bugs.values()],
      note: (draft ? draft.comment : last?.comment) ?? "",
    };
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Fill the picked columns of the run's sheet. Returns the sheet's link and what happened, in words. */
async function fillRunSheet(runId: string, hook: string, tab: string, secret: string, config: FillConfig) {
  const grid = await readSheet(hook, secret, tab);
  const layout = findLayout(grid, config.headerRow);
  if (!layout) throw new Error(`Couldn't find the header row in the ${tab} tab. Open Google Sheet on this run and look at the sheet again.`);
  const entries = await fillEntries(runId);
  const match = matchEntries(grid, layout, entries, config.rows);
  const cells = planCells(grid, layout, config, entries, match);
  const reply = await callSheet(hook, { secret, action: "fill", tab, cells });
  const parts = [`${plural(reply.filled ?? 0, "cell")} filled`];
  if (reply.kept) parts.push(`${plural(reply.kept, "typed cell")} kept`);
  if (match.unmatched.length) parts.push(`${plural(match.unmatched.length, "case")} not in the sheet`);
  return { url: reply.url, note: parts.join(", ") };
}

/** Send the run to its sheet now. Returns an error to show, or null. */
export async function pushRunToSheet(runId: string): Promise<string | null> {
  const run = await db.testRun.findUnique({
    where: { id: runId },
    select: { sheetHook: true, sheetTab: true, sheetMode: true, sheetFill: true, project: { select: { sheetSecret: true } } },
  });
  if (!SHEETS_ENABLED || !run?.sheetHook || !run.project.sheetSecret) return null;
  let error: string | null = null;
  let link: string | undefined;
  let note = "";
  try {
    if (run.sheetMode === "fill") {
      const done = await fillRunSheet(runId, run.sheetHook, run.sheetTab, run.project.sheetSecret, parseFillConfig(run.sheetFill));
      link = done.url;
      note = done.note;
    } else {
      const { header, rows, merges, caseEnds, caseStarts, testers } = await buildRunSheet(runId);
      const reply = await callSheet(run.sheetHook, {
        secret: run.project.sheetSecret,
        tab: run.sheetTab || "Flaw Patrol",
        rows: [header, ...rows].map((r) => r.map(cell)),
        merges,
        caseEnds,
        caseStarts,
        lists: { status: SHEET_CASE_STATUSES, testers },
        chips: STATUS_CHIPS,
        testerChip: TESTER_CHIP,
        formula: doneFormula(rows.length + 1),
        look: { ...SHEET_LOOK, ...sheetColors(rows) },
      });
      link = reply.url;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't reach the sheet.";
  }
  await db.testRun.update({
    where: { id: runId },
    data: error ? { sheetError: error } : { sheetError: "", sheetNote: note, sheetSyncedAt: new Date(), ...(link ? { sheetLink: link } : {}) },
  });
  return error;
}

// One push at a time per run; changes made during a push trigger one more.
const pushing = new Map<string, boolean>();

async function pushSoon(runId: string) {
  if (pushing.has(runId)) {
    pushing.set(runId, true);
    return;
  }
  try {
    do {
      pushing.set(runId, false);
      await pushRunToSheet(runId);
    } while (pushing.get(runId));
  } finally {
    pushing.delete(runId);
  }
}

/** After the response is sent, bring the run's sheet up to date, if it's set to follow along. */
export function queueSheetSync(run: { id: string; sheetHook: string | null; sheetAuto: boolean }) {
  if (SHEETS_ENABLED && run.sheetHook && run.sheetAuto) after(() => pushSoon(run.id));
}

export { sheetScript } from "@/lib/sheet-script";
