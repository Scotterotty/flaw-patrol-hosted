"use server";

import { logActivity } from "@/lib/activity";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { open, seal } from "@/lib/crypto";
import { db } from "@/lib/db";
import { requireProjectAction } from "@/lib/session";
import { postToSlack } from "@/lib/slack";
import { channelName, webhookProblem, type Alerts } from "@/lib/slack-alerts";
import { attempt, UserError } from "./result";

// Slack alerts: channels belong to an umbrella (or a test cycle outside one,
// or a test cycle that adds its own). The people who manage Jira manage them.

export type SlackTarget = { groupId: string } | { projectId: string };

const targetSchema = z.union([z.object({ groupId: z.string().max(40) }), z.object({ projectId: z.string().max(40) })]);
const alertsSchema = z.object({
  reg: z.boolean(),
  bug: z.boolean(),
  sev: z.enum(["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC"]),
  block: z.boolean(),
  run: z.boolean(),
  runDetail: z.boolean().default(true),
  bash: z.boolean().default(true),
  bashDetail: z.boolean().default(true),
  rc: z.boolean(),
  start: z.boolean(),
  join: z.boolean().default(true),
});
const nameSchema = z.string().trim().min(1, "Name the channel, like #qa-alerts").max(80).transform(channelName);
const hookSchema = z
  .string()
  .trim()
  .max(500)
  .superRefine((v, ctx) => {
    const problem = webhookProblem(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** Check the person may manage this target's channels; returns where to revalidate. */
async function manage(target: SlackTarget) {
  const t = targetSchema.parse(target);
  if ("groupId" in t) {
    const group = await db.projectGroup.findUnique({ where: { id: t.groupId }, select: { id: true, name: true, hubProjectId: true } });
    if (!group?.hubProjectId) throw new UserError("Umbrella not found.");
    const { user } = await requireProjectAction(group.hubProjectId, "jira:manage");
    return { where: { groupId: group.id }, paths: [`/g/${group.id}`], log: { actor: user, group } };
  }
  const { project, user } = await requireProjectAction(t.projectId, "jira:manage");
  return { where: { projectId: project.id }, paths: [`/p/${project.key}`, ...(project.groupId ? [`/g/${project.groupId}`] : [])], log: { actor: user, project } };
}

const refresh = (paths: string[]) => paths.forEach((p) => revalidatePath(p, "layout"));

async function ownChannel(target: SlackTarget, channelId: string) {
  const m = await manage(target);
  const row = await db.slackChannel.findFirst({ where: { id: z.string().max(40).parse(channelId), ...m.where } });
  if (!row) throw new UserError("That channel was removed. Reload the page.");
  return { ...m, row };
}

/** Send a test message to a webhook link before saving it, or to a saved channel. */
export async function testSlack(target: SlackTarget, input: { webhook?: string; channelId?: string; name: string }) {
  return attempt(async () => {
    let webhook: string;
    if (input.channelId) {
      const { row } = await ownChannel(target, input.channelId);
      webhook = open(row.webhookEncrypted);
    } else {
      await manage(target);
      webhook = hookSchema.parse(input.webhook ?? "");
    }
    try {
      await postToSlack(webhook, { tone: "blue", title: "👋 Flaw Patrol is connected", lines: [`Alerts you pick for ${channelName(input.name || "this channel")} will post here.`] });
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : "Slack refused the message.");
    }
    return {};
  });
}

/** Add a channel with its alerts. */
export async function addSlackChannel(target: SlackTarget, input: { webhook: string; name: string; alerts: Alerts }) {
  return attempt(async () => {
    const m = await manage(target);
    const data = { name: nameSchema.parse(input.name), webhookEncrypted: seal(hookSchema.parse(input.webhook)), alerts: alertsSchema.parse(input.alerts) as Prisma.InputJsonValue };
    if ((await db.slackChannel.count({ where: m.where })) >= 20) throw new UserError("That's 20 channels already. Remove one first.");
    const row = await db.slackChannel.create({ data: { ...data, ...m.where } });
    await logActivity({ ...m.log, kind: "settings", action: `Added Slack channel ${data.name}` });
    refresh(m.paths);
    return { id: row.id };
  });
}

/** Change a channel's name, webhook link (blank keeps it) or alerts. */
export async function updateSlackChannel(target: SlackTarget, channelId: string, input: { webhook?: string; name?: string; alerts?: Alerts }) {
  return attempt(async () => {
    const { row, paths, log } = await ownChannel(target, channelId);
    await logActivity({ ...log, kind: "settings", action: `Changed Slack channel ${row.name}`, detail: input.webhook?.trim() ? "Webhook replaced" : "" });
    await db.slackChannel.update({
      where: { id: row.id },
      data: {
        ...(input.name !== undefined && { name: nameSchema.parse(input.name) }),
        ...(input.webhook?.trim() && { webhookEncrypted: seal(hookSchema.parse(input.webhook)) }),
        ...(input.alerts && { alerts: alertsSchema.parse(input.alerts) as Prisma.InputJsonValue }),
      },
    });
    refresh(paths);
    return {};
  });
}

/** Remove a channel: its webhook link is deleted, and test cycles that ticked it drop it. */
export async function removeSlackChannel(target: SlackTarget, channelId: string) {
  return attempt(async () => {
    const { row, paths, log } = await ownChannel(target, channelId);
    await logActivity({ ...log, kind: "settings", action: `Removed Slack channel ${row.name}` });
    await db.$transaction(async (tx) => {
      await tx.slackChannel.delete({ where: { id: row.id } });
      if (row.groupId) {
        const picked = await tx.project.findMany({ where: { groupId: row.groupId, slackChannelIds: { has: row.id } }, select: { id: true, slackChannelIds: true } });
        for (const p of picked) await tx.project.update({ where: { id: p.id }, data: { slackChannelIds: p.slackChannelIds.filter((x) => x !== row.id) } });
      }
    });
    refresh(paths);
    return {};
  });
}

/** Pause every channel (nothing posts), or start them again. */
export async function pauseSlack(target: SlackTarget, paused: boolean) {
  return attempt(async () => {
    const m = await manage(target);
    await db.slackChannel.updateMany({ where: m.where, data: { paused: z.boolean().parse(paused) } });
    await logActivity({ ...m.log, kind: "settings", action: paused ? "Paused Slack alerts" : "Resumed Slack alerts" });
    refresh(m.paths);
    return {};
  });
}

/** A test cycle in an umbrella: follow the umbrella's channels, choose some (plus its own), or post nothing. */
export async function setCycleSlack(projectId: string, input: { mode: "umbrella" | "choose" | "off"; channelIds?: string[] }) {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    if (!project.groupId) throw new UserError("This test cycle isn't in an umbrella.");
    const mode = z.enum(["umbrella", "choose", "off"]).parse(input.mode);
    const ids = z.array(z.string().max(40)).max(50).parse(input.channelIds ?? []);
    const valid = ids.length ? (await db.slackChannel.findMany({ where: { id: { in: ids }, groupId: project.groupId }, select: { id: true } })).map((c) => c.id) : [];
    await db.project.update({ where: { id: project.id }, data: { slackMode: mode, ...(mode === "choose" && { slackChannelIds: valid }) } });
    revalidatePath(`/p/${project.key}`, "layout");
    await logActivity({ actor: user, kind: "settings", action: "Changed Slack alerts for this test cycle", project, detail: mode === "off" ? "Off" : mode === "umbrella" ? "Same as umbrella" : `${valid.length} channel${valid.length === 1 ? "" : "s"}` });
    return {};
  });
}
