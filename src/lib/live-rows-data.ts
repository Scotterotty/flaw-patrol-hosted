import type { ResultStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { parseDraft } from "@/lib/run-draft";
import { resultSteps } from "@/lib/result-steps";
import { withoutHeadings } from "@/lib/step-checks";
import type { LiveRow } from "@/lib/live-rows";

type EntryBits = {
  id: string;
  status: ResultStatus;
  assigneeId: string | null;
  steps: unknown;
  draft: unknown;
  draftAt: Date | null;
  draftByName: string;
  draftById: string | null;
  results: { stepResults: unknown; testerName: string; testerId: string | null; createdAt: Date }[];
};

/** What a run list row shows that changes while people test: status, step pips and who's on it. */
export function liveRowOf(e: EntryBits, meId: string): LiveRow {
  const saved = e.status !== "IN_PROGRESS" && e.status !== "UNTESTED" ? e.results[0] : undefined;
  const draft = e.status === "IN_PROGRESS" ? parseDraft(e.draft) : null;
  return {
    id: e.id,
    status: e.status,
    assigneeId: e.assigneeId,
    progress: draft ? withoutHeadings(e.steps, draft.stepResults).map((s) => s.status) : saved ? resultSteps(saved.stepResults, e.steps) : null,
    lastChange: draft
      ? e.draftAt
        ? { name: e.draftByName, at: e.draftAt.toISOString(), mine: e.draftById === meId }
        : null
      : saved
        ? { name: saved.testerName, at: saved.createdAt.toISOString(), mine: saved.testerId === meId, saved: true }
        : null,
  };
}

/** Every row of a run, for open run pages to update in place without reloading. */
export async function liveRowsFor(runId: string, meId: string): Promise<LiveRow[]> {
  const entries = await db.runEntry.findMany({
    where: { runId },
    select: {
      id: true,
      status: true,
      assigneeId: true,
      steps: true,
      draft: true,
      draftAt: true,
      draftByName: true,
      draftById: true,
      results: { orderBy: { createdAt: "desc" }, take: 1, select: { stepResults: true, testerName: true, testerId: true, createdAt: true } },
    },
  });
  return entries.map((e) => liveRowOf(e, meId));
}
