import "server-only";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { pathOf } from "@/lib/folders";
import { parseTestData } from "@/lib/test-data";
import { expandForRun, parseCaseSteps, parseParams, parsePlainSteps, sharedStepIdsIn, type SharedStepDef } from "@/lib/steps";
import { csvFile, FORMAT_INFO, tableFor, type ExportCase, type ExportFormat, type Table } from "@/lib/case-export";

/** The most cases one export holds. */
export const EXPORT_MAX = 20000;

/** Cases for Export cases (ver_190), in number order, with shared steps written out and test data rows filled in. Charters never come along. */
export async function exportCases(project: { id: string; key: string }, where: Prisma.TestCaseWhereInput): Promise<ExportCase[]> {
  const cases = await db.testCase.findMany({
    where: { AND: [where, { projectId: project.id, type: { not: "EXPLORATORY" } }] },
    orderBy: { number: "asc" },
    take: EXPORT_MAX,
    select: {
      number: true,
      title: true,
      preconditions: true,
      priority: true,
      type: true,
      automationId: true,
      tags: true,
      jiraStories: true,
      sourceKey: true,
      folderId: true,
      versions: { orderBy: { version: "desc" }, take: 1, select: { steps: true, testData: true } },
    },
  });
  const items = cases.map((c) => parseCaseSteps(c.versions[0]?.steps));
  const sharedIds = [...new Set(items.flatMap(sharedStepIdsIn))];
  const [shared, folders] = await Promise.all([
    sharedIds.length ? db.sharedStep.findMany({ where: { id: { in: sharedIds } }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }) : [],
    db.folder.findMany({ where: { projectId: project.id }, select: { id: true, parentId: true, name: true } }),
  ]);
  const defs = new Map<string, SharedStepDef>(
    shared.map((s) => [s.id, { id: s.id, name: s.name, version: s.currentVersion, parameters: parseParams(s.versions[0]?.parameters), steps: parsePlainSteps(s.versions[0]?.steps) }]),
  );
  return cases.map((c, i) => ({
    key: caseKey(project.key, c.number),
    sourceKey: c.sourceKey,
    title: c.title,
    folder: c.folderId ? pathOf(folders, c.folderId) : [],
    preconditions: c.preconditions,
    priority: c.priority,
    automated: c.type === "AUTOMATED" || !!c.automationId,
    automationId: c.automationId || null,
    tags: c.tags,
    requirements: c.jiraStories,
    steps: expandForRun(items[i], defs, parseTestData(c.versions[0]?.testData)),
  }));
}

/** An .xlsx of the table: bold header that stays put, wrapped text, a line above each case. */
async function workbook(t: Table, sheetName: string): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRows([t.header, ...t.rows]);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col, i) => {
    const longest = Math.max(t.header[i].length, ...t.rows.slice(0, 500).map((r) => String(r[i] ?? "").split("\n").reduce((m, l) => Math.max(m, l.length), 0)));
    col.width = Math.min(60, Math.max(8, longest + 2));
    col.alignment = { wrapText: true, vertical: "top" };
  });
  for (const s of t.starts.slice(1)) sheet.getRow(s + 2).border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** The file to download: its bytes and content type. */
export async function exportFile(format: ExportFormat, cases: ExportCase[]): Promise<{ body: Uint8Array | string; type: string }> {
  const t = tableFor(format, cases);
  if (FORMAT_INFO[format].ext === "csv") return { body: csvFile(t, format), type: "text/csv; charset=utf-8" };
  return { body: await workbook(t, format === "qtest" ? "Test Cases" : "Cases"), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
