"use server";

import { logActivity } from "@/lib/activity";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { draftSchema } from "@/lib/run-draft";
import { caseOutcome, guessColumns, matchTester, readSheet, RUN_FIELDS, type ColumnMap, type ImportStatus, type SheetCase } from "@/lib/run-import";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";
import { jiraConfigFor, libraryProjectIds } from "@/lib/umbrella";

const sheetSchema = z.object({
  fileName: z.string().max(300).default(""),
  rows: z.array(z.array(z.string().max(50_000)).max(200)).min(2, "That file has no rows under the header.").max(50_000),
  map: z.record(z.enum(RUN_FIELDS), z.number().int().min(0).max(199)).nullable().default(null),
  // Sheet tester name → member id, or "" to keep the name as text. Unlisted names use the automatic match.
  links: z.record(z.string().max(200), z.string().max(40)).default({}),
});
type SheetInput = z.input<typeof sheetSchema>;

type Member = { id: string; name: string; email: string };

/** Read the sheet and work out what the run would hold, without saving anything. */
async function plan(projectId: string, projectKey: string, input: z.output<typeof sheetSchema>) {
  const [header, ...data] = input.rows;
  const map: ColumnMap = input.map ?? guessColumns(header);
  if (map.key === undefined && map.title === undefined) throw new UserError("Pick the column that holds the case key or title.");
  if (map.stepStatus === undefined && map.caseStatus === undefined) throw new UserError("Pick the column that holds the step or case results.");
  const { cases: sheetCases, unknownWords } = readSheet(data, map);

  const [library, memberRows, project] = await Promise.all([
    db.testCase.findMany({ where: { projectId, archived: false }, select: { id: true, number: true, title: true, sourceKey: true } }),
    db.projectMember.findMany({ where: { projectId }, select: { userId: true, user: { select: { name: true, email: true } } } }),
    db.project.findUniqueOrThrow({ where: { id: projectId }, select: { runImportAliases: true } }),
  ]);
  const members: Member[] = memberRows.map((m) => ({ id: m.userId, name: m.user.name ?? "", email: m.user.email })).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const aliases = (project.runImportAliases ?? {}) as Record<string, string>;

  const byKey = new Map<string, (typeof library)[number]>();
  for (const c of library) {
    if (c.sourceKey) byKey.set(c.sourceKey.toLowerCase(), c);
    byKey.set(caseKey(projectKey, c.number).toLowerCase(), c);
  }
  const titleCount = new Map<string, number>();
  for (const c of library) titleCount.set(c.title.toLowerCase(), (titleCount.get(c.title.toLowerCase()) ?? 0) + 1);
  const byTitle = new Map(library.filter((c) => titleCount.get(c.title.toLowerCase()) === 1).map((c) => [c.title.toLowerCase(), c]));

  const matched: { sheet: SheetCase; caseId: string; number: number; title: string }[] = [];
  const notFound: { key: string; title: string; row: number }[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const sc of sheetCases) {
    const c = (sc.key && byKey.get(sc.key.toLowerCase())) || (sc.title && byTitle.get(sc.title.toLowerCase())) || null;
    if (!c) notFound.push({ key: sc.key, title: sc.title, row: sc.row });
    else if (seen.has(c.id)) duplicates.push(sc.key || sc.title);
    else {
      seen.add(c.id);
      matched.push({ sheet: sc, caseId: c.id, number: c.number, title: c.title });
    }
  }

  // Every tester name in the sheet, with who it is in Flaw Patrol.
  const names = new Map<string, number>();
  for (const m of matched) if (m.sheet.tester) names.set(m.sheet.tester, (names.get(m.sheet.tester) ?? 0) + 1);
  const testers = [...names.entries()].map(([name, cases]) => {
    const link = input.links[name];
    const member = link !== undefined ? (members.find((m) => m.id === link) ?? null) : matchTester(name, members, aliases);
    return { name, cases, memberId: member?.id ?? "", auto: link === undefined };
  });
  const testerOf = new Map(testers.map((t) => [t.name, members.find((m) => m.id === t.memberId) ?? null]));

  // Cases are snapshotted the way a normal run would snapshot them, so step counts are exact.
  const entries = await buildEntries(db as unknown as Parameters<typeof buildEntries>[0], projectId, matched.map((m) => m.caseId), null);
  const stepsOf = new Map(entries.map((e) => [e.caseId, Array.isArray(e.steps) ? e.steps.length : 0]));
  const rows = matched.map((m) => {
    const steps = stepsOf.get(m.caseId) ?? 0;
    return {
      ...m,
      steps,
      sheetSteps: m.sheet.steps.length,
      outcome: caseOutcome(m.sheet, steps),
      member: testerOf.get(m.sheet.tester) ?? null,
    };
  });
  const counts: Record<ImportStatus | "IN_PROGRESS", number> = { UNTESTED: 0, PASSED: 0, FAILED: 0, BLOCKED: 0, RETEST: 0, SKIPPED: 0, IN_PROGRESS: 0 };
  for (const r of rows) counts[r.outcome]++;
  return { header, map, rows, notFound, duplicates, unknownWords, testers, members, counts, entries };
}

/** What the import would do: shown on the check screen before anything is saved. */
export async function previewRunImport(projectId: string, input: SheetInput) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:import");
    const p = await plan(project.id, project.key, sheetSchema.parse(input));
    return {
      header: p.header,
      map: p.map,
      matched: p.rows.length,
      stepResults: p.rows.reduce((n, r) => n + r.sheet.steps.filter((s) => s.status !== "UNTESTED").length, 0),
      counts: p.counts,
      notFound: p.notFound,
      duplicates: p.duplicates,
      unknownWords: p.unknownWords,
      stepMismatches: p.rows.filter((r) => r.sheetSteps !== r.steps).map((r) => ({ key: caseKey(project.key, r.number), sheetKey: r.sheet.key, sheet: r.sheetSteps, steps: r.steps })),
      bugs: [...new Set(p.rows.flatMap((r) => r.sheet.defects))].length,
      testers: p.testers,
      members: p.members.map((m) => ({ id: m.id, name: m.name || m.email })),
    };
  });
}

const runSchema = z.object({
  name: z.string().trim().min(1, "Give the run a name").max(200),
  release: z.string().trim().max(200).default(""),
  testedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was tested"),
  suiteId: z.string().nullable().default(null),
});

/** Create the run from the sheet. It stays open so unfinished cases can be finished here. */
export async function importRun(projectId: string, input: SheetInput, run: z.input<typeof runSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:import");
    const sheet = sheetSchema.parse(input);
    const meta = runSchema.parse(run);
    const p = await plan(project.id, project.key, sheet);
    if (!p.rows.length) throw new UserError("None of the cases in the sheet are in this test cycle yet. Import the cases first.");
    // Noon UTC, so the date reads the same in the US and the UK.
    const at = new Date(Math.min(new Date(`${meta.testedOn}T12:00:00Z`).getTime(), Date.now()));
    const suite = meta.suiteId ? await db.testSuite.findFirst({ where: { id: meta.suiteId, projectId: { in: await libraryProjectIds(project) } }, select: { id: true, currentVersion: true } }) : null;
    const jira = await jiraConfigFor(projectId);
    const note = `Imported from ${sheet.fileName || "a spreadsheet"}`;

    const number = await db.$transaction(
      async (tx) => {
        const { runSeq } = await tx.project.update({ where: { id: projectId }, data: { runSeq: { increment: 1 } } });
        const created = await tx.testRun.create({
          data: {
            projectId,
            number: runSeq,
            suiteId: suite?.id ?? null,
            suiteVersion: suite?.currentVersion ?? null,
            name: meta.name,
            release: meta.release,
            kind: meta.release ? "rc" : "",
            description: note,
            createdById: user.id,
            createdBy: user.name ?? user.email,
            createdAt: at,
            entries: { create: p.entries.map(({ assigneeId, ...e }) => (void assigneeId, e)) },
          },
          include: { entries: { select: { id: true, caseId: true, caseVersion: true, steps: true } } },
        });
        const entryOf = new Map(created.entries.map((e) => [e.caseId, e]));
        for (const r of p.rows) {
          const e = entryOf.get(r.caseId)!;
          const stepResults = Array.from({ length: r.steps }, (_, i) => ({ status: r.sheet.steps[i]?.status ?? "UNTESTED", actual: r.sheet.steps[i]?.actual ?? "" }));
          const testerName = r.member ? r.member.name || r.member.email : r.sheet.tester;
          const assigneeId = r.member?.id ?? null;
          if (r.outcome === "IN_PROGRESS") {
            const draft = draftSchema.parse({ stepResults, override: null, comment: "", elapsedSec: 0 });
            await tx.runEntry.update({ where: { id: e.id }, data: { status: "IN_PROGRESS", assigneeId, draft: draft as Prisma.InputJsonValue, draftAt: at, draftByName: testerName, draftById: assigneeId ?? null } });
          } else if (r.outcome === "UNTESTED") {
            if (assigneeId) await tx.runEntry.update({ where: { id: e.id }, data: { assigneeId } });
          } else {
            const result = await tx.testResult.create({
              data: { entryId: e.id, runId: created.id, caseId: r.caseId, caseVersion: e.caseVersion, status: r.outcome, stepResults, comment: note, testerId: assigneeId, testerName, imported: true, createdAt: at },
            });
            await tx.runEntry.update({ where: { id: e.id }, data: { status: r.outcome, lastTestedAt: at, assigneeId } });
            for (const key of r.sheet.defects) {
              let defect = await tx.defect.findFirst({ where: { projectId, externalKey: key }, select: { id: true } });
              if (!defect) {
                const { defectSeq } = await tx.project.update({ where: { id: projectId }, data: { defectSeq: { increment: 1 } } });
                defect = await tx.defect.create({
                  data: { projectId, number: defectSeq, title: key, externalKey: key, externalUrl: jira ? `${jira.siteUrl}/browse/${key}` : null, createdById: user.id, createdBy: user.name ?? user.email, filed: false },
                  select: { id: true },
                });
              }
              await tx.defectLink.create({ data: { defectId: defect.id, resultId: result.id, stepIndex: null } });
            }
          }
        }
        // Remember the links chosen by hand, for this project's next import.
        const chosen = Object.entries(sheet.links).filter(([, id]) => id && p.members.some((m) => m.id === id));
        if (chosen.length) {
          const current = (await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { runImportAliases: true } })).runImportAliases as Record<string, string>;
          const next = { ...current, ...Object.fromEntries(chosen.map(([name, id]) => [name.trim().toLowerCase(), id])) };
          await tx.project.update({ where: { id: projectId }, data: { runImportAliases: next } });
        }
        return created.number;
      },
      { timeout: 180_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Imported a run from a spreadsheet as run R${number}`, project });
    revalidatePath(`/p/${project.key}`, "layout");
    return { number };
  });
}
