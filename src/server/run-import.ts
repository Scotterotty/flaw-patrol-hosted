"use server";

import { queueQaseSend } from "@/lib/qase-sync";
import { logActivity } from "@/lib/activity";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { caseKey } from "@/lib/format";
import { draftSchema } from "@/lib/run-draft";
import { caseOutcome, guessColumns, intoRunAction, matchTester, readSheet, RUN_FIELDS, type ColumnMap, type ImportStatus, type SheetCase } from "@/lib/run-import";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";
import { jiraConfigFor, libraryProjectIds } from "@/lib/umbrella";
import { NOT_BASH_RUN } from "@/lib/bash-cases";

const sheetSchema = z.object({
  fileName: z.string().max(300).default(""),
  rows: z.array(z.array(z.string().max(50_000)).max(200)).min(2, "That file has no rows under the header.").max(50_000),
  // partialRecord: a sheet maps only some fields (zod 4's record with enum keys needs every key).
  map: z.partialRecord(z.enum(RUN_FIELDS), z.number().int().min(0).max(199)).nullable().default(null),
  // Sheet tester name → member id, or "" to keep the name as text. Unlisted names use the automatic match.
  links: z.record(z.string().max(200), z.string().max(40)).default({}),
});
type SheetInput = z.input<typeof sheetSchema>;

type Member = { id: string; name: string; email: string };
type Tx = Prisma.TransactionClient;

/** Link a saved result to the Jira bugs the sheet names, making a bug for any new key. */
async function linkDefects(tx: Tx, a: { projectId: string; resultId: string; keys: string[]; jira: { siteUrl: string } | null; user: { id: string; name: string | null; email: string } }) {
  for (const key of a.keys) {
    let defect = await tx.defect.findFirst({ where: { projectId: a.projectId, externalKey: key }, select: { id: true } });
    if (!defect) {
      const { defectSeq } = await tx.project.update({ where: { id: a.projectId }, data: { defectSeq: { increment: 1 } } });
      defect = await tx.defect.create({
        data: { projectId: a.projectId, number: defectSeq, title: key, externalKey: key, externalUrl: a.jira ? `${a.jira.siteUrl}/browse/${key}` : null, createdById: a.user.id, createdBy: a.user.name ?? a.user.email, filed: false },
        select: { id: true },
      });
    }
    await tx.defectLink.create({ data: { defectId: defect.id, resultId: a.resultId, stepIndex: null } });
  }
}

/** Remember the tester links chosen by hand, for this project's next import. */
async function rememberLinks(tx: Tx, projectId: string, links: Record<string, string>, members: Member[]) {
  const chosen = Object.entries(links).filter(([, id]) => id && members.some((m) => m.id === id));
  if (!chosen.length) return;
  const current = (await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { runImportAliases: true } })).runImportAliases as Record<string, string>;
  const next = { ...current, ...Object.fromEntries(chosen.map(([name, id]) => [name.trim().toLowerCase(), id])) };
  await tx.project.update({ where: { id: projectId }, data: { runImportAliases: next } });
}

/** Read the sheet and work out what the run would hold, without saving anything. */
async function plan(project: { id: string; key: string; groupId: string | null }, input: z.output<typeof sheetSchema>) {
  const projectId = project.id;
  // In an umbrella, the cases come from its Case library too (ver_166: they weren't found before).
  const libraryIds = await libraryProjectIds(project);
  const [header, ...data] = input.rows;
  const map: ColumnMap = input.map ?? guessColumns(header);
  if (map.key === undefined && map.title === undefined) throw new UserError("Pick the column that holds the case key or title.");
  if (map.stepStatus === undefined && map.caseStatus === undefined) throw new UserError("Pick the column that holds the step or case results.");
  const { cases: sheetCases, unknownWords } = readSheet(data, map);

  const [library, memberRows, saved] = await Promise.all([
    db.testCase.findMany({ where: { projectId: { in: libraryIds }, archived: false }, select: { id: true, number: true, title: true, sourceKey: true, project: { select: { key: true } } } }),
    db.projectMember.findMany({ where: { projectId }, select: { userId: true, user: { select: { name: true, email: true } } } }),
    db.project.findUniqueOrThrow({ where: { id: projectId }, select: { runImportAliases: true } }),
  ]);
  const members: Member[] = memberRows.map((m) => ({ id: m.userId, name: m.user.name ?? "", email: m.user.email })).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const aliases = (saved.runImportAliases ?? {}) as Record<string, string>;

  const byKey = new Map<string, (typeof library)[number]>();
  for (const c of library) {
    if (c.sourceKey) byKey.set(c.sourceKey.toLowerCase(), c);
    byKey.set(caseKey(c.project.key, c.number).toLowerCase(), c);
  }
  const titleCount = new Map<string, number>();
  for (const c of library) titleCount.set(c.title.toLowerCase(), (titleCount.get(c.title.toLowerCase()) ?? 0) + 1);
  const byTitle = new Map(library.filter((c) => titleCount.get(c.title.toLowerCase()) === 1).map((c) => [c.title.toLowerCase(), c]));

  const matched: { sheet: SheetCase; caseId: string; number: number; key: string; title: string }[] = [];
  const notFound: { key: string; title: string; row: number }[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const sc of sheetCases) {
    const c = (sc.key && byKey.get(sc.key.toLowerCase())) || (sc.title && byTitle.get(sc.title.toLowerCase())) || null;
    if (!c) notFound.push({ key: sc.key, title: sc.title, row: sc.row });
    else if (seen.has(c.id)) duplicates.push(sc.key || sc.title);
    else {
      seen.add(c.id);
      matched.push({ sheet: sc, caseId: c.id, number: c.number, key: caseKey(c.project.key, c.number), title: c.title });
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
  const entries = await buildEntries(db as unknown as Parameters<typeof buildEntries>[0], libraryIds, matched.map((m) => m.caseId), null);
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
export async function previewRunImport(projectId: string, input: SheetInput, runId: string | null = null) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:import");
    const p = await plan(project, sheetSchema.parse(input));
    const into = runId ? await intoPlan(project.id, runId, p) : null;
    return {
      into: into && {
        fill: into.fill.length,
        fillInProgress: into.fill.filter((f) => f.outcome === "IN_PROGRESS").length,
        skipped: into.skipped,
        disagree: into.disagree.map((d) => ({ caseId: d.row.caseId, key: d.key, title: d.row.title, here: d.here, sheet: d.sheet, by: d.by, at: d.at })),
        automated: into.automated,
        notInRun: into.notInRun,
        blank: into.blank,
      },
      header: p.header,
      map: p.map,
      matched: p.rows.length,
      stepResults: p.rows.reduce((n, r) => n + r.sheet.steps.filter((s) => s.status !== "UNTESTED").length, 0),
      counts: p.counts,
      notFound: p.notFound,
      duplicates: p.duplicates,
      unknownWords: p.unknownWords,
      stepMismatches: p.rows.filter((r) => r.sheetSteps !== r.steps).map((r) => ({ key: r.key, sheetKey: r.sheet.key, sheet: r.sheetSteps, steps: r.steps })),
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
  /** The run kind picked in Create a run (ver_177). Blank: Release candidate when there's a release, as before. */
  runKind: z.string().trim().max(40).default(""),
});

/** Create the run from the sheet. It stays open so unfinished cases can be finished here. */
export async function importRun(projectId: string, input: SheetInput, run: z.input<typeof runSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:import");
    const sheet = sheetSchema.parse(input);
    const meta = runSchema.parse(run);
    const p = await plan(project, sheet);
    if (!p.rows.length) throw new UserError("None of the cases in the sheet are in the case library yet. Import the cases first.");
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
            kind: meta.runKind || (meta.release ? "rc" : ""),
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
            await linkDefects(tx, { projectId, resultId: result.id, keys: r.sheet.defects, jira, user });
          }
        }
        await rememberLinks(tx, projectId, sheet.links, p.members);
        return created.number;
      },
      { timeout: 180_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Imported a run from a spreadsheet as run R${number}`, project });
    queueQaseSend(projectId);
    revalidatePath(`/p/${project.key}`, "layout");
    return { number };
  });
}

type Plan = Awaited<ReturnType<typeof plan>>;

/**
 * Adding a sheet to a run in progress (ver_166, persona audit): the sheet only fills cases
 * still untested in the run. Cases already marked here are skipped; where the sheet's result
 * is different they're listed as disagreeing, and change only when ticked. A blank or
 * "Select" in the sheet never clears anything.
 */
async function intoPlan(projectId: string, runId: string, p: Plan) {
  const run = await db.testRun.findFirst({ where: { id: runId, projectId, state: "ACTIVE", automated: false, ...NOT_BASH_RUN }, select: { id: true, number: true, name: true } });
  if (!run) throw new UserError("That run isn't in progress any more. Pick another run, or make a new one.");
  const entries = await db.runEntry.findMany({
    where: { runId: run.id, caseId: { in: p.rows.map((r) => r.caseId) } },
    select: { id: true, caseId: true, caseVersion: true, status: true, steps: true, assigneeId: true, draft: true, lastTestedAt: true, kind: true },
  });
  // Who saved each result here and when, shown next to a result the sheet would replace (ver_177).
  const latest = await db.testResult.findMany({
    where: { entryId: { in: entries.map((e) => e.id) } },
    orderBy: { createdAt: "desc" },
    distinct: ["entryId"],
    select: { entryId: true, testerName: true, createdAt: true },
  });
  const latestOf = new Map(latest.map((l) => [l.entryId, l]));
  const entryOf = new Map(entries.map((e) => [e.caseId, e]));
  type Entry = (typeof entries)[number];
  const fill: { row: Plan["rows"][number]; entry: Entry; steps: number; outcome: ImportStatus | "IN_PROGRESS" }[] = [];
  const disagree: { row: Plan["rows"][number]; entry: Entry; steps: number; key: string; here: string; sheet: ImportStatus; by: string; at: string | null }[] = [];
  const notInRun: { key: string; title: string }[] = [];
  let skipped = 0;
  let blank = 0;
  // Automated cases are left to the automation: a sheet never changes them (ver_177).
  let automated = 0;
  for (const r of p.rows) {
    const key = r.key;
    const entry = entryOf.get(r.caseId);
    if (!entry) {
      notInRun.push({ key: r.sheet.key || key, title: r.title });
      continue;
    }
    if (entry.kind === "AUTOMATED") {
      automated++;
      continue;
    }
    const steps = Array.isArray(entry.steps) ? entry.steps.length : 0;
    const outcome = caseOutcome(r.sheet, steps);
    const action = intoRunAction(entry.status, entry.draft !== null, outcome);
    if (action === "blank") blank++;
    else if (action === "fill") fill.push({ row: r, entry, steps, outcome });
    else if (action === "disagree") {
      const last = latestOf.get(entry.id);
      disagree.push({ row: r, entry, steps, key, here: entry.status, sheet: outcome as ImportStatus, by: last?.testerName ?? "", at: (last?.createdAt ?? entry.lastTestedAt)?.toISOString() ?? null });
    }
    else skipped++;
  }
  return { run, fill, disagree, notInRun, skipped, blank, automated };
}

const intoSchema = z.object({
  runId: z.string().min(1).max(40),
  testedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was tested"),
  /** Cases where the sheet's result replaces the one here. Create a run and the check page tick them all (ver_177). */
  useSheet: z.array(z.string().max(40)).max(50_000).default([]),
});

/** Add the sheet's results to a run in progress. Returns the run's number. */
export async function importIntoRun(projectId: string, input: SheetInput, into: z.input<typeof intoSchema>) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "run:import");
    const sheet = sheetSchema.parse(input);
    const meta = intoSchema.parse(into);
    const p = await plan(project, sheet);
    const ip = await intoPlan(project.id, meta.runId, p);
    const use = new Set(meta.useSheet);
    const overrides = ip.disagree.filter((d) => use.has(d.row.caseId));
    if (!ip.fill.length && !overrides.length) throw new UserError("Nothing to add: every case in the sheet is already marked in this run, or has no result in the sheet.");
    const at = new Date(Math.min(new Date(`${meta.testedOn}T12:00:00Z`).getTime(), Date.now()));
    const jira = await jiraConfigFor(projectId);
    const note = `Imported from ${sheet.fileName || "a spreadsheet"}`;
    const stepResultsOf = (r: Plan["rows"][number], steps: number) => Array.from({ length: steps }, (_, i) => ({ status: r.sheet.steps[i]?.status ?? "UNTESTED", actual: r.sheet.steps[i]?.actual ?? "" }));

    const counts = await db.$transaction(
      async (tx) => {
        let filled = 0;
        let replaced = 0;
        for (const f of ip.fill) {
          // Someone may have marked it since the preview: only fill it if it's still untested.
          const fresh = await tx.runEntry.findUnique({ where: { id: f.entry.id }, select: { status: true, draft: true, assigneeId: true } });
          if (!fresh || fresh.status !== "UNTESTED" || fresh.draft !== null) continue;
          const r = f.row;
          const stepResults = stepResultsOf(r, f.steps);
          const testerName = r.member ? r.member.name || r.member.email : r.sheet.tester;
          const testerId = r.member?.id ?? null;
          // A case already assigned to someone keeps its assignee.
          const assigneeId = fresh.assigneeId ?? testerId;
          if (f.outcome === "IN_PROGRESS") {
            const draft = draftSchema.parse({ stepResults, override: null, comment: "", elapsedSec: 0 });
            await tx.runEntry.update({ where: { id: f.entry.id }, data: { status: "IN_PROGRESS", assigneeId, draft: draft as Prisma.InputJsonValue, draftAt: at, draftByName: testerName, draftById: testerId } });
          } else {
            const result = await tx.testResult.create({
              data: { entryId: f.entry.id, runId: ip.run.id, caseId: r.caseId, caseVersion: f.entry.caseVersion, status: f.outcome, stepResults, comment: note, testerId, testerName, imported: true, createdAt: at },
            });
            await tx.runEntry.update({ where: { id: f.entry.id }, data: { status: f.outcome, lastTestedAt: at, assigneeId } });
            await linkDefects(tx, { projectId, resultId: result.id, keys: r.sheet.defects, jira, user });
          }
          filled++;
        }
        for (const d of overrides) {
          const r = d.row;
          // A new result on top: the one already here stays in the case's history.
          const last = d.entry.lastTestedAt?.getTime() ?? 0;
          const when = new Date(Math.min(Math.max(at.getTime(), last + 1000), Date.now()));
          const testerName = r.member ? r.member.name || r.member.email : r.sheet.tester;
          const result = await tx.testResult.create({
            data: { entryId: d.entry.id, runId: ip.run.id, caseId: r.caseId, caseVersion: d.entry.caseVersion, status: d.sheet, stepResults: stepResultsOf(r, d.steps), comment: `${note}: the sheet's result was used`, testerId: r.member?.id ?? null, testerName, imported: true, createdAt: when },
          });
          await tx.runEntry.update({ where: { id: d.entry.id }, data: { status: d.sheet, lastTestedAt: when } });
          await linkDefects(tx, { projectId, resultId: result.id, keys: r.sheet.defects, jira, user });
          replaced++;
        }
        await rememberLinks(tx, projectId, sheet.links, p.members);
        return { filled, replaced };
      },
      { timeout: 180_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Added ${counts.filled + counts.replaced} results from a spreadsheet to run R${ip.run.number}`, project });
    queueQaseSend(projectId);
    revalidatePath(`/p/${project.key}`, "layout");
    return { number: ip.run.number, ...counts };
  });
}
