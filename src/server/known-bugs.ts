"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

/**
 * Still happens / Didn't happen on a known bug, or null to undo. Recorded for this
 * run's case only; it never changes Jira.
 */
export async function checkKnownBug(projectId: string, entryId: string, defectId: string, outcome: "still" | "gone" | null) {
  return attempt(async () => {
    const { user } = await requireProjectAction(projectId, "run:execute");
    const entry = await db.runEntry.findFirst({ where: { id: entryId, run: { projectId } }, select: { id: true, runId: true, run: { select: { state: true } } } });
    if (!entry) throw new UserError("This case is no longer in the run.");
    if (entry.run.state === "COMPLETED") throw new UserError("This run is closed. Reopen it to record results.");
    const how = z.enum(["still", "gone"]).nullable().parse(outcome);
    if (how === null) await db.defectCheck.deleteMany({ where: { defectId, entryId } });
    else
      await db.defectCheck.upsert({
        where: { defectId_entryId: { defectId, entryId } },
        create: { defectId, entryId, runId: entry.runId, outcome: how, byId: user.id, byName: user.name ?? user.email },
        update: { outcome: how, byId: user.id, byName: user.name ?? user.email, createdAt: new Date() },
      });
    return {};
  });
}
