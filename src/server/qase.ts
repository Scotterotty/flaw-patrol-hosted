"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { open, seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import type { Action } from "@/lib/permissions";
import { QaseClient, QaseError } from "@/lib/qase";
import { parseQaseCaseId, QASE_STATUSES } from "@/lib/qase-map";
import { syncCycle } from "@/lib/qase-sync";
import { requireProjectAction } from "@/lib/session";
import { attempt, UserError } from "./result";

// Qase (ver_164): Settings → Qase, Link cases, and Sync now on a test cycle.

async function requireGroup(groupId: string, action: Action) {
  const group = await db.projectGroup.findUnique({ where: { id: groupId }, include: { hub: true, qase: true } });
  if (!group?.hub) throw new UserError("This isn't an umbrella.");
  const { user } = await requireProjectAction(group.hub.id, action);
  return { user, group, hub: group.hub };
}

async function qase<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof QaseError) throw new UserError(e.message);
    throw e;
  }
}

function savedToken(sealed: string) {
  try {
    return open(sealed);
  } catch {
    throw new UserError("The saved Qase token can't be read here (it was saved with a different AUTH_SECRET). Paste it again.");
  }
}

function refresh(groupId: string) {
  revalidatePath(`/g/${groupId}`, "layout");
}

/** Check a token (or the saved one) and list the Qase projects it can see. */
export async function qaseProjects(groupId: string, token: string) {
  return attempt(async () => {
    const { group } = await requireGroup(groupId, "jira:manage");
    const t = token.trim() || (group.qase ? savedToken(group.qase.tokenEncrypted) : "");
    if (!t) throw new UserError("Paste a Qase API token. Make one in Qase: your avatar → API tokens → Create a new API token.");
    const projects = await qase(() => new QaseClient(t).projects());
    if (!projects.length) throw new UserError("The token works, but it can't see any Qase projects.");
    return { projects };
  });
}

const qaseStatus = z.enum(["", ...QASE_STATUSES]);
const statusMapSchema = z.object({ PASSED: qaseStatus, FAILED: qaseStatus, BLOCKED: qaseStatus, RETEST: qaseStatus, SKIPPED: qaseStatus });

const saveSchema = z.object({
  token: z.string().trim().max(500).default(""),
  projectCode: z.string().trim().min(1, "Pick a Qase project.").max(20),
  send: z.boolean(),
  bring: z.boolean(),
  statusMap: statusMapSchema,
});

/** Save and test: the token must open the picked Qase project. */
export async function saveQase(groupId: string, input: z.input<typeof saveSchema>) {
  return attempt(async () => {
    const { group, user } = await requireGroup(groupId, "jira:manage");
    if (group.archivedAt) throw new UserError(`${group.name} is archived. Restore it to change Qase.`);
    const data = saveSchema.parse(input);
    if (!data.token && !group.qase) throw new UserError("Paste a Qase API token.");
    const token = data.token || savedToken(group.qase!.tokenEncrypted);
    const project = await qase(() => new QaseClient(token).project(data.projectCode));
    const moved = group.qase && group.qase.projectCode !== project.code;
    const fields = { projectCode: project.code, projectTitle: project.title, send: data.send, bring: data.bring, statusMap: data.statusMap, connectedBy: user.name ?? user.email, ...(data.token ? { tokenEncrypted: seal(data.token) } : {}) };
    await db.$transaction(async (tx) => {
      await tx.qaseConfig.upsert({
        where: { groupId },
        create: { groupId, tokenEncrypted: seal(token), hookSecret: randomBytes(18).toString("base64url"), ...fields },
        update: fields,
      });
      // Another Qase project: the old links and runs mean nothing there.
      if (moved) await forget(tx, groupId);
    });
    await logActivity({ actor: user, kind: "settings", action: `${group.qase ? "Changed" : "Connected"} Qase project ${project.code}`, group, detail: data.token && group.qase ? "Token replaced" : "" });
    refresh(groupId);
    return { projectTitle: project.title, code: project.code };
  });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function forget(tx: Tx, groupId: string) {
  const where = { OR: [{ groupId }, { hubOf: { id: groupId } }] };
  await tx.testCase.updateMany({ where: { project: where, qaseId: { not: null } }, data: { qaseId: null } });
  await tx.project.updateMany({ where, data: { qaseRunId: null, qaseRunTitle: "", qaseSyncedAt: null, qaseError: "" } });
}

/** Stop sharing: the token, case links and runs are forgotten. Results already shared stay where they are. */
export async function disconnectQase(groupId: string) {
  return attempt(async () => {
    const { group, user } = await requireGroup(groupId, "jira:manage");
    await db.$transaction(async (tx) => {
      await tx.qaseConfig.deleteMany({ where: { groupId } });
      await forget(tx, groupId);
    });
    await logActivity({ actor: user, kind: "settings", action: "Disconnected Qase", group });
    refresh(groupId);
    return {};
  });
}

/** Link one case: a Qase ID ("OKO-42" or 42), "skip" for don't share, or "" to unlink. */
export async function linkQaseCase(groupId: string, caseId: string, value: string) {
  return attempt(async () => {
    const { group } = await requireGroup(groupId, "case:edit");
    if (!group.qase) throw new UserError("Connect Qase first in Settings → Qase.");
    const c = await db.testCase.findFirst({ where: { id: caseId, project: { OR: [{ groupId }, { hubOf: { id: groupId } }] } }, select: { id: true } });
    if (!c) throw new UserError("That case isn't in this umbrella any more.");
    const v = value.trim();
    const qaseId = v === "skip" ? 0 : v === "" ? null : parseQaseCaseId(v, group.qase.projectCode);
    if (qaseId === null && v !== "") throw new UserError(`Type a Qase case ID like ${group.qase.projectCode}-42.`);
    await db.testCase.update({ where: { id: c.id }, data: { qaseId } });
    refresh(groupId);
    return { qaseId };
  });
}

async function requireCycle(projectId: string, action: Action) {
  const { user } = await requireProjectAction(projectId, action);
  const p = await db.project.findUnique({ where: { id: projectId }, select: { id: true, key: true, groupId: true, archivedAt: true, group: { select: { qase: true, archivedAt: true } } } });
  if (!p?.group?.qase) throw new UserError("This test cycle's umbrella isn't connected to Qase.");
  return { user, p, cfg: p.group.qase };
}

/** Sync now: send what's waiting and bring in Qase's newest results. */
export async function syncQaseNow(projectId: string) {
  return attempt(async () => {
    const { p } = await requireCycle(projectId, "run:execute");
    if (p.archivedAt || p.group?.archivedAt) throw new UserError("Archived test cycles don't share with Qase.");
    const out = await syncCycle(projectId);
    revalidatePath(`/p/${p.key}`, "layout");
    if (!out.ok) throw new UserError(out.error);
    return { sent: out.sent, brought: out.brought, linked: out.linked, skipped: out.skipped ?? "" };
  });
}

/** The open Qase runs a test cycle could share with instead of its own. */
export async function qaseRuns(projectId: string) {
  return attempt(async () => {
    const { cfg } = await requireCycle(projectId, "run:manage");
    const runs = await qase(() => new QaseClient(savedToken(cfg.tokenEncrypted)).runs(cfg.projectCode));
    return { runs };
  });
}

/** Share with another Qase run, or "new" to make one named after the test cycle on the next sync. */
export async function setQaseRun(projectId: string, runId: number | "new") {
  return attempt(async () => {
    const { p, cfg } = await requireCycle(projectId, "run:manage");
    if (runId === "new") {
      await db.project.update({ where: { id: projectId }, data: { qaseRunId: null, qaseRunTitle: "", qaseError: "" } });
    } else {
      const run = await qase(() => new QaseClient(savedToken(cfg.tokenEncrypted)).run(cfg.projectCode, runId));
      await db.project.update({ where: { id: projectId }, data: { qaseRunId: run.id, qaseRunTitle: run.title, qaseError: "" } });
    }
    // Results already sent went to the old run; the new one gets each case's newest result.
    await db.testResult.updateMany({ where: { run: { projectId }, fromQase: false, qaseHash: { not: null } }, data: { qaseHash: null } });
    const out = await syncCycle(projectId);
    revalidatePath(`/p/${p.key}`, "layout");
    if (!out.ok) throw new UserError(out.error);
    return {};
  });
}
