"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { appOrigin } from "@/lib/invites";
import { mailOn, sendMail } from "@/lib/mail";
import { requireProjectAction, requireUser } from "@/lib/session";
import { notify } from "@/lib/slack";
import { TOOL_IDS, toolById, toolsOn, toolsValue, turnOn, type ToolId } from "@/lib/tools";
import { attempt, UserError } from "./result";

// Settings → Tools: which tools an umbrella uses. Admins change it; turning a tool
// off only hides it, so nothing made with it is ever deleted.

const toolsSchema = z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length);

async function umbrellaOf(groupId: string) {
  const group = await db.projectGroup.findUnique({ where: { id: groupId }, include: { hub: { select: { id: true, key: true } } } });
  if (!group?.hub) throw new UserError("This isn't an umbrella.");
  return { group, hub: group.hub };
}

/** Save the umbrella's whole list of tools that are on. Admins only. */
export async function setUmbrellaTools(groupId: string, input: ToolId[]) {
  return attempt(() => save(groupId, () => toolsSchema.parse(input)));
}

/** Turn on one tool (and what it needs), from an old link or Ctrl+K. Admins only. */
export async function turnOnTool(groupId: string, tool: ToolId) {
  return attempt(() => save(groupId, (before) => turnOn(before, z.enum(TOOL_IDS).parse(tool)).on));
}

async function save(groupId: string, next: (before: ToolId[]) => ToolId[]) {
  const { group, hub } = await umbrellaOf(groupId);
  const { user, role } = await requireProjectAction(hub.id, "members:manage");
  if (role !== "ADMIN" && !user.isAdmin) throw new UserError("Only Admins can change which tools an umbrella uses.");
  if (group.archivedAt) throw new UserError(`${group.name} is archived. Restore it in its Settings first.`);
  const before = toolsOn(group.tools);
  const value = toolsValue(next(before));
  await db.projectGroup.update({ where: { id: group.id }, data: { tools: value } });
  const on = toolsOn(value);
  const added = on.filter((t) => !before.includes(t)).map((t) => toolById[t].name);
  const removed = before.filter((t) => !on.includes(t)).map((t) => toolById[t].name);
  await logActivity({
    actor: user,
    kind: "settings",
    action: "Changed tools",
    group,
    detail: [added.length && `Turned on ${added.join(", ")}`, removed.length && `Turned off ${removed.join(", ")}`].filter(Boolean).join(" · ") || "No change",
  });
  revalidatePath("/", "layout");
  return { on };
}

/**
 * Someone who isn't an Admin asks for a tool to be turned on: the umbrella's Admins get an
 * email when email is set up, and the Slack channels that hear about join requests get a post.
 */
export async function askForTool(groupId: string, tool: ToolId) {
  return attempt(async () => {
    const user = await requireUser();
    const { group, hub } = await umbrellaOf(groupId);
    const id = z.enum(TOOL_IDS).parse(tool);
    const t = toolById[id];
    const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: hub.id, userId: user.id } } });
    if (!member && !user.isAdmin) throw new UserError(`You aren't on ${group.name}'s team.`);
    const admins = await db.projectMember.findMany({ where: { projectId: hub.id, role: "ADMIN", userId: { not: user.id } }, include: { user: { select: { email: true, name: true } } } });
    const who = user.name ?? user.email;
    const url = `${await appOrigin()}/g/${group.id}/settings#tools`;
    let emailed = 0;
    if (admins.length && (await mailOn())) {
      for (const a of admins) {
        try {
          await sendMail({
            to: a.user.email,
            subject: `${who} asks to turn on ${t.name} in ${group.name}`,
            lines: [`${who} would like ${t.name} turned on in ${group.name}.`, `${t.name}: ${t.what}. Anything made with it before is still there.`],
            button: { label: "Open Settings → Tools", url },
          });
          emailed++;
        } catch {
          // One address failing doesn't stop the others.
        }
      }
    }
    await notify(hub.id, "join", (base) => ({
      tone: "blue",
      title: `🙋 ${who} asks to turn on ${t.name}`,
      lines: [`in ${group.name}. An Admin can turn it on in Settings → Tools.`],
      button: { label: "Open Settings → Tools", url: `${base}/g/${group.id}/settings#tools` },
    }));
    await logActivity({ actor: user, kind: "settings", action: `Asked to turn on ${t.name}`, group });
    return { emailed, admins: admins.map((a) => a.user.name ?? a.user.email) };
  });
}
