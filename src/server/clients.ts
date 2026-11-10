"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResultStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { libraryProjectIds } from "@/lib/umbrella";
import { cleanClients, clientOfRow, MAX_CLIENT_NAME, MAX_CLIENTS } from "@/lib/clients";
import { parseDraft } from "@/lib/run-draft";
import { headingRows } from "@/lib/step-checks";
import { parseTestData } from "@/lib/test-data";
import { deriveCaseStatus } from "@/lib/status";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";
import { saveDraft, submitResult } from "./results";

// Clients (ver_214): a test cycle's clients, which clients a case covers, and marking one
// client's result straight from the run page's grid.

const namesSchema = z.array(z.string().max(MAX_CLIENT_NAME * 2)).max(MAX_CLIENTS * 2);

/** Settings → test cycle → Clients. Runs started after this use the new list; runs already going keep theirs. */
export async function saveCycleClients(projectId: string, names: string[]) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "project:manage");
    const list = namesSchema.parse(names);
    const clients = cleanClients(list);
    if (list.filter((n) => n.trim()).length > MAX_CLIENTS) throw new UserError(`A test cycle can have up to ${MAX_CLIENTS} clients.`);
    await db.project.update({ where: { id: project.id }, data: { clients } });
    revalidatePath(`/p/${project.key}`, "layout");
    if (project.groupId) revalidatePath(`/g/${project.groupId}`, "layout");
    return { clients };
  });
}

/**
 * Which clients a case is tested on. Saved on the case for runs started later; cases in open runs
 * that nobody has touched yet pick it up straight away.
 */
export async function saveCaseClients(projectId: string, caseId: string, names: string[]) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "case:edit");
    const clients = cleanClients(namesSchema.parse(names));
    if (!clients.length) throw new UserError("Tick at least one client.");
    const library = await libraryProjectIds(project);
    const c = await db.testCase.findFirst({ where: { id: caseId, projectId: { in: library } }, select: { id: true, project: { select: { key: true } } } });
    if (!c) throw new UserError("That case no longer exists.");
    await db.testCase.update({ where: { id: c.id }, data: { clients } });
    // Open runs with clients: untouched copies of this case take the new clients.
    const fresh = await db.runEntry.findMany({
      where: { caseId: c.id, status: "UNTESTED", draftAt: null, results: { none: {} }, run: { state: "ACTIVE", NOT: { clients: { isEmpty: true } } } },
      select: { id: true, run: { select: { clients: true, project: { select: { id: true, groupId: true, key: true } } } } },
    });
    let updated = 0;
    for (const e of fresh) {
      const lib = await libraryProjectIds(e.run.project);
      const [next] = await db.$transaction((tx) => buildEntries(tx, lib, [c.id], null, { clients: e.run.clients }));
      if (!next) continue;
      await db.runEntry.update({ where: { id: e.id }, data: { steps: next.steps, testData: next.testData, clients: next.clients, caseVersion: next.caseVersion } });
      updated++;
      revalidatePath(`/p/${e.run.project.key}`, "layout");
    }
    revalidatePath(`/p/${c.project.key}`, "layout");
    return { clients, updated };
  });
}

const markSchema = z.object({
  client: z.string().min(1).max(MAX_CLIENT_NAME * 2),
  status: z.enum(["UNTESTED", "PASSED", "FAILED", "BLOCKED"]),
});

/**
 * The run page grid: mark every step of one client's rows at once. When every client then has a
 * result, the case result is saved (the worst client's); until then it stays In progress.
 */
export async function markClient(projectId: string, entryId: string, input: z.input<typeof markSchema>) {
  return attempt(async () => {
    await requireProjectAction(projectId, "run:execute");
    const { client, status } = markSchema.parse(input);
    const entry = await db.runEntry.findFirst({
      where: { id: entryId, run: { projectId } },
      include: { run: { select: { state: true } }, results: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!entry) throw new UserError("This case is no longer in the run.");
    if (entry.run.state === "COMPLETED") throw new UserError("This run is closed. Reopen it to record results.");
    const steps = Array.isArray(entry.steps) ? (entry.steps as { row?: number }[]) : [];
    const data = parseTestData(entry.testData);
    const mine = steps.flatMap((s, i) => (clientOfRow(entry.clients, data, s?.row) === client ? [i] : []));
    if (!mine.length) throw new UserError(`This case doesn't run on ${client}.`);
    const headings = headingRows(entry.steps);
    const draft = entry.status === "IN_PROGRESS" ? parseDraft(entry.draft) : null;
    const last = entry.results[0];
    const fromLast = Array.isArray(last?.stepResults) && last.stepResults.length === steps.length ? (last.stepResults as { status: ResultStatus; actual?: string }[]) : null;
    const base =
      draft?.stepResults.length === steps.length
        ? draft.stepResults
        : (fromLast?.map((s) => ({ status: s.status, actual: s.actual ?? "" })) ?? steps.map(() => ({ status: "UNTESTED" as const, actual: "" })));
    type Step = { status: Exclude<ResultStatus, "IN_PROGRESS">; actual: string };
    const next = (base as Step[]).map((s, i): Step => (mine.includes(i) && !headings.has(i) ? { ...s, status } : s));
    const results = next.filter((_, i) => !headings.has(i)).map((s) => s.status as ResultStatus);
    const done = results.length > 0 && results.every((s) => s !== "UNTESTED");
    if (done) {
      const r = await submitResult(projectId, entryId, {
        status: deriveCaseStatus(results) as Exclude<ResultStatus, "UNTESTED" | "IN_PROGRESS">,
        stepResults: next,
        comment: draft?.comment ?? (fromLast ? (last?.comment ?? "") : ""),
        elapsedSec: draft?.elapsedSec ?? null,
        attachmentIds: draft?.attachments.map((a) => a.id) ?? [],
        defects: draft?.defects.map((d) => ({ existingId: d.defect.id, stepIndex: d.stepIndex })) ?? [],
      });
      if (!r.ok) throw new UserError(r.error);
      return { status: deriveCaseStatus(results) };
    }
    const r = await saveDraft(
      projectId,
      entryId,
      {
        stepResults: next,
        override: null,
        comment: draft?.comment ?? "",
        elapsedSec: draft?.elapsedSec ?? 0,
        attachments: draft?.attachments ?? [],
        defects: draft?.defects ?? [],
      },
      { steps: mine, override: false, comment: false, attachments: false, defects: false },
    );
    if (!r.ok) throw new UserError(r.error);
    return { status: r.status };
  });
}
