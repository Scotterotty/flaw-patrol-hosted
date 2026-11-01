"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { cleanEmail, parseDigestSettings, parsePrefs, stopPrefs } from "@/lib/digest-settings";
import { readStopToken } from "@/lib/digest-token";
import { sendSampleDigest } from "@/lib/digests";
import { requireProjectAction, requireUser } from "@/lib/session";
import { origin } from "@/lib/slack";
import { attempt, UserError } from "./result";

// Email digests and email groups (ver_132). The people who manage Slack alerts manage an
// umbrella's digests; anyone can make or edit an email group; only admins delete one.

export type DigestTarget = { groupId: string } | { projectId: string };
const targetSchema = z.union([z.object({ groupId: z.string().max(40) }), z.object({ projectId: z.string().max(40) })]);

const settingsSchema = z.object({
  testers: z.boolean(),
  starter: z.boolean(),
  everyone: z.boolean(),
  groupIds: z.array(z.string().max(40)).max(50),
  addresses: z.array(z.string().max(200)).max(100),
  run: z.boolean(),
  bash: z.boolean(),
  rc: z.boolean(),
});

/** Check the person may change this target's digests. */
async function manage(target: DigestTarget) {
  const t = targetSchema.parse(target);
  if ("groupId" in t) {
    const group = await db.projectGroup.findUnique({ where: { id: t.groupId }, select: { id: true, name: true, hubProjectId: true } });
    if (!group?.hubProjectId) throw new UserError("Umbrella not found.");
    const { user } = await requireProjectAction(group.hubProjectId, "jira:manage");
    return { user, group, project: null, teamIds: [group.hubProjectId, ...(await db.project.findMany({ where: { groupId: group.id }, select: { id: true } })).map((p) => p.id)] };
  }
  const { project, user } = await requireProjectAction(t.projectId, "jira:manage");
  return { user, group: null, project, teamIds: [project.id] };
}

const refresh = () => revalidatePath("/", "layout");

/** Save who gets digests and what is sent. Saving turns them on. */
export async function saveDigest(target: DigestTarget, input: z.input<typeof settingsSchema>) {
  return attempt(async () => {
    const m = await manage(target);
    const v = settingsSchema.parse(input);
    const bad = v.addresses.find((a) => !cleanEmail(a));
    if (bad) throw new UserError(`"${bad}" isn't an email address.`);
    const groups = v.groupIds.length ? (await db.emailGroup.findMany({ where: { id: { in: v.groupIds } }, select: { id: true } })).map((g) => g.id) : [];
    const settings = parseDigestSettings({ ...v, groupIds: groups, on: true });
    if (m.group) await db.projectGroup.update({ where: { id: m.group.id }, data: { emailDigest: settings } });
    else await db.project.update({ where: { id: m.project!.id }, data: { emailDigest: settings, ...(m.project!.groupId && { emailDigestMode: "choose" }) } });
    await logActivity({ actor: m.user, kind: "settings", action: "Changed email digests", ...(m.group ? { group: m.group } : { project: m.project! }) });
    refresh();
    return {};
  });
}

/** Turn digests off, keeping the choices for next time. */
export async function turnOffDigest(target: DigestTarget) {
  return attempt(async () => {
    const m = await manage(target);
    if (m.group) {
      const now = await db.projectGroup.findUniqueOrThrow({ where: { id: m.group.id }, select: { emailDigest: true } });
      await db.projectGroup.update({ where: { id: m.group.id }, data: { emailDigest: { ...parseDigestSettings(now.emailDigest), on: false } } });
    } else await db.project.update({ where: { id: m.project!.id }, data: { emailDigest: { ...parseDigestSettings(m.project!.emailDigest), on: false } } });
    await logActivity({ actor: m.user, kind: "settings", action: "Turned off email digests", ...(m.group ? { group: m.group } : { project: m.project! }) });
    refresh();
    return {};
  });
}

/** A test cycle in an umbrella: the umbrella's digests, its own, or none. */
export async function setCycleDigest(projectId: string, mode: "umbrella" | "choose" | "off") {
  return attempt(async () => {
    const { project, user } = await requireProjectAction(projectId, "jira:manage");
    if (!project.groupId) throw new UserError("This test cycle isn't in an umbrella.");
    const m = z.enum(["umbrella", "choose", "off"]).parse(mode);
    // Choosing starts from the umbrella's choices, so there's something to change.
    let own = {};
    if (m === "choose" && !parseDigestSettings(project.emailDigest).on) {
      const g = await db.projectGroup.findUnique({ where: { id: project.groupId }, select: { emailDigest: true } });
      own = { emailDigest: { ...parseDigestSettings(g?.emailDigest), on: true } };
    }
    await db.project.update({ where: { id: project.id }, data: { emailDigestMode: m, ...own } });
    await logActivity({ actor: user, kind: "settings", action: "Changed email digests for this test cycle", project, detail: m === "off" ? "Off" : m === "umbrella" ? "Same as umbrella" : "Own choice" });
    refresh();
    return {};
  });
}

/** Send me a sample: the newest run here, laid out as a digest, to the person asking only. */
export async function sendDigestSample(target: DigestTarget) {
  return attempt(async () => {
    const m = await manage(target);
    try {
      return { note: await sendSampleDigest(m.teamIds, m.user, await origin()) };
    } catch (e) {
      throw new UserError(e instanceof Error ? e.message : "The sample couldn't be sent.");
    }
  });
}

// ---- Email groups ----

const groupSchema = z.object({
  id: z.string().max(40).nullable(),
  name: z.string().trim().min(1, "Name the group, like Mobile leads").max(60, "Keep the name under 60 characters."),
  userIds: z.array(z.string().max(40)).max(200),
  addresses: z.array(z.string().max(200)).max(200),
});

/** Make or change an email group. Anyone signed in can. */
export async function saveEmailGroup(input: z.input<typeof groupSchema>) {
  return attempt(async () => {
    const user = await requireUser();
    const v = groupSchema.parse(input);
    const addresses = v.addresses.map((a) => ({ a, e: cleanEmail(a) }));
    const bad = addresses.find((x) => !x.e);
    if (bad) throw new UserError(`"${bad.a}" isn't an email address.`);
    const userIds = v.userIds.length ? (await db.user.findMany({ where: { id: { in: v.userIds } }, select: { id: true } })).map((u) => u.id) : [];
    // An address that belongs to someone in Flaw Patrol is kept as that person, so their own choice applies.
    const known = await db.user.findMany({ where: { email: { in: addresses.map((x) => x.e!), mode: "insensitive" } }, select: { id: true, email: true } });
    const people = [...new Set([...userIds, ...known.map((k) => k.id)])];
    const outside = [...new Set(addresses.map((x) => x.e!).filter((e) => !known.some((k) => k.email.toLowerCase() === e)))];
    if (!people.length && !outside.length) throw new UserError("Add at least one person or address.");
    const clash = await db.emailGroup.findFirst({ where: { name: { equals: v.name, mode: "insensitive" }, ...(v.id && { id: { not: v.id } }) }, select: { id: true } });
    if (clash) throw new UserError(`There's already a group called ${v.name}. Pick another name.`);
    const data = { name: v.name, userIds: people, addresses: outside };
    const g = v.id
      ? await db.emailGroup.update({ where: { id: v.id }, data }).catch(() => {
          throw new UserError("That group was deleted. Reload the page.");
        })
      : await db.emailGroup.create({ data: { ...data, createdById: user.id, createdBy: user.name || user.email } });
    await logActivity({ actor: user, kind: "settings", action: `${v.id ? "Changed" : "Made"} the email group ${g.name}`, detail: `${people.length + outside.length} in it` });
    refresh();
    return { id: g.id, name: g.name };
  });
}

/** Delete an email group: workspace admins only. Umbrellas that used it stop sending to it. */
export async function deleteEmailGroup(id: string) {
  return attempt(async () => {
    const user = await requireUser();
    if (!user.isAdmin) throw new UserError("Only workspace admins can delete an email group.");
    const g = await db.emailGroup.findUnique({ where: { id: z.string().max(40).parse(id) } });
    if (!g) throw new UserError("That group was already deleted.");
    await db.emailGroup.delete({ where: { id: g.id } });
    await logActivity({ actor: user, kind: "settings", action: `Deleted the email group ${g.name}` });
    refresh();
    return {};
  });
}

// ---- Your account → Emails I get ----

const prefsSchema = z.object({ runs: z.enum(["tested", "all", "none"]), bashes: z.enum(["joined", "all", "none"]), rc: z.boolean() });

export async function saveDigestPrefs(input: z.input<typeof prefsSchema>) {
  return attempt(async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { digestPrefs: prefsSchema.parse(input) } });
    revalidatePath("/account");
    return {};
  });
}

/** The Stop link in a digest email. No sign-in: the signed link says who and which kind. */
export async function stopDigestEmails(token: string) {
  return attempt(async () => {
    const t = readStopToken(z.string().max(1000).parse(token));
    if (!t) throw new UserError("This stop link isn't valid. Use the link in the newest email.");
    const user = await db.user.findFirst({ where: { email: { equals: t.email, mode: "insensitive" } }, select: { id: true, digestPrefs: true } });
    if (user) await db.user.update({ where: { id: user.id }, data: { digestPrefs: stopPrefs(parsePrefs(user.digestPrefs), t.kind) } });
    else {
      const ws = await db.workspace.upsert({ where: { id: 1 }, create: { id: 1 }, update: {}, select: { digestStopped: true } });
      if (!ws.digestStopped.includes(t.email)) await db.workspace.update({ where: { id: 1 }, data: { digestStopped: { push: t.email } } });
    }
    return { member: !!user, kind: t.kind };
  });
}
