"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { auditComment, auditNeedsComment, auditNoteRequired, claimLive, fieldChanges, isOutcome, parseFilterInput, pickNext, type Editable } from "@/lib/bug-audit";
import { auditClaims, auditIssues, forgetAudit } from "@/lib/bug-audit-server";
import { ISSUE_KEY, loadTicket } from "@/lib/bug-board-server";
import { db } from "@/lib/db";
import { JiraError, jiraFor, type JiraClient } from "@/lib/jira";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { loadUmbrella } from "@/lib/umbrella";
import { attempt, UserError } from "./result";

// Bug audit (ver_250). Everyone who can test in the umbrella can check bugs; setting the audit
// up (its filter, label and date) is for whoever can manage the umbrella's Jira connection.

async function jiraOf(hubId: string) {
  const client = await jiraFor(hubId).catch((e) => {
    throw e instanceof JiraError ? new UserError(e.message) : e;
  });
  if (!client) throw new UserError("Jira isn't connected for this umbrella.");
  return client;
}

/** Run a Jira call, turning Jira's refusals into a message for the page. */
async function inJira<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof JiraError ? new UserError(e.message) : e;
  }
}

async function forAudit(auditId: string) {
  const user = await requireUser();
  const audit = await db.bugAudit.findUnique({ where: { id: auditId } });
  const u = audit && (await loadUmbrella(audit.groupId, user));
  if (!audit || !u || !can(u.who, "run:execute")) throw new UserError("You can't check bugs in this audit.");
  // The name that signs Jira comments: never the email, which Jira readers shouldn't see.
  return { user, audit, u, me: user.name?.trim() || user.email.split("@")[0] };
}

const setupSchema = z.object({
  name: z.string().trim().min(1, "Give the audit a name.").max(80, "Keep the name under 80 characters."),
  filter: z.string().trim().min(1, "Paste the Jira filter link, its number, or JQL."),
  label: z
    .string()
    .trim()
    .min(1, "Pick the label checked bugs get.")
    .max(60)
    .regex(/^[^\s,]+$/, "A Jira label can't have spaces or commas."),
  dueOn: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date."),
});

/** Start the umbrella's bug audit, or change the one that's going. */
export async function saveBugAudit(groupId: string, input: z.input<typeof setupSchema>) {
  return attempt(async () => {
    const user = await requireUser();
    const u = await loadUmbrella(groupId, user);
    if (!u || !can(u.who, "jira:manage")) throw new UserError("Only people who manage this umbrella's Jira can set up an audit.");
    const v = setupSchema.parse(input);
    const filter = parseFilterInput(v.filter);
    if (!filter) throw new UserError("That isn't a Jira filter link, a filter number or JQL.");
    const client = await jiraOf(u.hub.id);
    // Check the filter works before anyone relies on it.
    await inJira(() => client.searchFields(filter.jql, ["summary"], 1));
    const data = { name: v.name, jql: filter.jql, filterId: filter.filterId, label: v.label, dueOn: v.dueOn ? new Date(`${v.dueOn}T23:59:59Z`) : null };
    const current = await db.bugAudit.findFirst({ where: { groupId, endedAt: null }, orderBy: { createdAt: "desc" } });
    const audit = current
      ? await db.bugAudit.update({ where: { id: current.id }, data })
      : await db.bugAudit.create({ data: { ...data, groupId, createdById: user.id, createdBy: user.name || user.email } });
    forgetAudit(audit.id);
    await logActivity({ actor: user, kind: "settings", action: current ? "Changed the bug audit" : "Started a bug audit", group: { id: groupId, name: u.group.name }, detail: `${v.name} · label ${v.label}` });
    revalidatePath(`/g/${groupId}/bugs/audit`);
    return { id: audit.id };
  });
}

/** End the audit: its results stay, and Next bug stops handing out bugs. */
export async function endBugAudit(auditId: string) {
  return attempt(async () => {
    const user = await requireUser();
    const audit = await db.bugAudit.findUnique({ where: { id: auditId } });
    const u = audit && (await loadUmbrella(audit.groupId, user));
    if (!audit || !u || !can(u.who, "jira:manage")) throw new UserError("Only people who manage this umbrella's Jira can end the audit.");
    await db.bugAudit.update({ where: { id: auditId }, data: { endedAt: new Date() } });
    await logActivity({ actor: user, kind: "settings", action: "Ended the bug audit", group: { id: audit.groupId, name: u.group.name }, detail: audit.name });
    revalidatePath(`/g/${audit.groupId}/bugs/audit`);
    return {};
  });
}

async function claim(auditId: string, key: string, title: string, user: { id: string }, me: string) {
  const now = new Date();
  const existing = await db.bugAuditCheck.findUnique({ where: { auditId_issueKey: { auditId, issueKey: key } } });
  if (existing && claimLive(existing, now) && existing.claimedById !== user.id) throw new UserError(`${existing.claimedBy.split(/\s+/)[0]} is checking ${key}.`);
  // Taking a bug lets go of any other you hold here but didn't check: you've moved on.
  await db.bugAuditCheck.updateMany({ where: { auditId, claimedById: user.id, checkedAt: null, issueKey: { not: key } }, data: { claimedById: null, claimedBy: "", claimedAt: null } });
  // A bug checked before can be checked again (someone reopened it in Jira): start fresh.
  const fresh = { claimedById: user.id, claimedBy: me, claimedAt: now, title, outcome: "", checkedAt: null, checkedById: null, checkedBy: "" };
  await db.bugAuditCheck.upsert({ where: { auditId_issueKey: { auditId, issueKey: key } }, create: { auditId, issueKey: key, ...fresh }, update: fresh });
}

const pickSchema = z.object({ platform: z.string().max(60).default(""), component: z.string().max(200).default(""), skip: z.array(z.string().regex(ISSUE_KEY)).max(200).default([]) });

/** Next bug: the next one nobody holds that fits your pick, now yours. Null when there's none left. */
export async function nextAuditBug(auditId: string, input: z.input<typeof pickSchema>) {
  return attempt(async () => {
    const { user, audit, u, me } = await forAudit(auditId);
    if (audit.endedAt) throw new UserError("This audit has ended.");
    const pick = pickSchema.parse(input);
    const client = await jiraOf(u.hub.id);
    const { issues } = await inJira(() => auditIssues(audit, client));
    // Next bug moves you on: the bug you had (unchecked) goes back for someone else, and you get a different one.
    const held = await db.bugAuditCheck.findMany({ where: { auditId, claimedById: user.id, checkedAt: null }, select: { issueKey: true } });
    const skip = [...new Set([...pick.skip, ...held.map((h) => h.issueKey)])];
    if (held.length) await db.bugAuditCheck.updateMany({ where: { auditId, claimedById: user.id, checkedAt: null }, data: { claimedById: null, claimedBy: "", claimedAt: null } });
    // Two people pressing Next bug at once: whoever loses the claim gets the one after.
    for (let tries = 0; tries < 5; tries++) {
      const next = pickNext(issues, await auditClaims(auditId), user.id, new Date(), pick, skip);
      if (!next) return { key: null };
      try {
        await claim(auditId, next.key, next.title, user, me);
        return { key: next.key };
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
      }
    }
    throw new UserError("Everyone grabbed the same bugs at once. Try Next bug again.");
  });
}

/** Take one bug from the list. */
export async function claimAuditBug(auditId: string, key: string) {
  return attempt(async () => {
    const { user, audit, u, me } = await forAudit(auditId);
    if (audit.endedAt) throw new UserError("This audit has ended.");
    if (!ISSUE_KEY.test(key)) throw new UserError("That isn't a Jira key.");
    const client = await jiraOf(u.hub.id);
    const { issues } = await inJira(() => auditIssues(audit, client));
    await claim(auditId, key, issues.find((i) => i.key === key)?.title ?? "", user, me);
    return { key };
  });
}

/** Still on it: the Audit page renews the claim every few minutes while the bug is open. */
export async function keepAuditBug(auditId: string, key: string) {
  return attempt(async () => {
    const { user } = await forAudit(auditId);
    const kept = await db.bugAuditCheck.updateMany({ where: { auditId, issueKey: key, claimedById: user.id, checkedAt: null }, data: { claimedAt: new Date() } });
    return { kept: kept.count > 0 };
  });
}

/** Let a bug go without checking it. */
export async function releaseAuditBug(auditId: string, key: string) {
  return attempt(async () => {
    const { user } = await forAudit(auditId);
    await db.bugAuditCheck.updateMany({ where: { auditId, issueKey: key, claimedById: user.id, checkedAt: null }, data: { claimedById: null, claimedBy: "", claimedAt: null } });
    return {};
  });
}

type RawFields = { fields: { summary?: string; priority?: { name?: string } | null; components?: { name?: string }[]; versions?: { name?: string }[]; status?: { name?: string }; updated?: string } };

async function editableNow(client: JiraClient, key: string) {
  const r = await client.read<RawFields>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,priority,components,versions,status,updated`);
  const names = (l?: { name?: string }[]) => (l ?? []).map((x) => x.name ?? "").filter(Boolean);
  const editable: Editable = { summary: r.fields.summary ?? "", priority: r.fields.priority?.name ?? "", components: names(r.fields.components), versions: names(r.fields.versions) };
  return { editable, status: r.fields.status?.name ?? "", updated: r.fields.updated ?? "" };
}

/** Everything the check needs for one bug: the ticket, the fields you can change and their choices. */
export async function openAuditBug(auditId: string, key: string) {
  return attempt(async () => {
    const { u } = await forAudit(auditId);
    if (!ISSUE_KEY.test(key)) throw new UserError("That isn't a Jira key.");
    const client = await jiraOf(u.hub.id);
    const [ticket, now, meta, moves] = await inJira(() => Promise.all([loadTicket(client, key), editableNow(client, key), client.issueEditMeta(key).catch(() => []), client.transitions(key).catch(() => [])]));
    const opts = (id: string) => meta.find((m) => m.id === id);
    return {
      ticket,
      editable: now.editable,
      status: now.status,
      updated: now.updated,
      // Only fields on the bug's Edit screen can change; the rest show as text.
      options: {
        priority: opts("priority")?.options ?? null,
        components: opts("components")?.options ?? null,
        versions: opts("versions")?.options ?? null,
        summary: !!opts("summary"),
      },
      moves: moves.map((m) => ({ id: m.id, to: m.to })),
    };
  });
}

/** A bug's summary, or a plain message when Jira has no such bug. */
async function titleOf(client: JiraClient, key: string) {
  try {
    const r = await client.read<{ fields: { summary?: string } }>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary`);
    return r.fields.summary ?? "";
  } catch (e) {
    if (e instanceof JiraError && /not found/i.test(e.message)) throw new UserError(`Couldn't find ${key} in Jira. Check the key.`);
    throw e instanceof JiraError ? new UserError(e.message) : e;
  }
}

/** Duplicate (ver_256): the other bug's summary, so the person sees they typed the right key. */
export async function auditBugTitle(auditId: string, key: string) {
  return attempt(async () => {
    const { u } = await forAudit(auditId);
    const k = key.trim().toUpperCase();
    if (!ISSUE_KEY.test(k)) throw new UserError("Type a bug key, like OB-3921.");
    return { title: await titleOf(await jiraOf(u.hub.id), k) };
  });
}

const listOf = z.array(z.string().trim().min(1).max(200)).max(50);
const editableSchema = z.object({ summary: z.string().trim().min(1, "The summary can't be empty.").max(255), priority: z.string().max(100), components: listOf, versions: listOf });
const verifySchema = z.object({
  outcome: z.string().refine(isOutcome, "Pick what you found."),
  clients: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  build: z.string().trim().max(100).default(""),
  note: z.string().trim().max(2000).default(""),
  edits: editableSchema,
  /** The fields as they were when the bug was opened, to spot someone else's change in Jira. */
  seen: editableSchema.extend({ summary: z.string().max(255) }),
  seenUpdated: z.string().max(60),
  moveTo: z.string().max(40).default(""),
  /** Duplicate (ver_256): the bug it duplicates, linked in Jira. */
  duplicateOf: z.string().trim().toUpperCase().max(40).default(""),
  /** Save even though someone changed the bug in Jira since it was opened. */
  force: z.boolean().default(false),
});

/**
 * Save and next (ver_256, was Verify): save any field changes, add the audit's label (whatever was
 * found), link a duplicate, move it if asked, and leave the person's note as a comment, signed with
 * their name. Still happens with no note is the label only (ver_255). A bug that still happens stays open.
 */
export async function verifyAuditBug(auditId: string, key: string, input: z.input<typeof verifySchema>) {
  return attempt(async () => {
    const { user, audit, u, me } = await forAudit(auditId);
    if (!ISSUE_KEY.test(key)) throw new UserError("That isn't a Jira key.");
    const v = verifySchema.parse(input);
    if (auditNoteRequired(v.outcome as never) && !v.note) throw new UserError("Say why in the note first. It goes in the Jira comment.");
    if (v.outcome === "dupe") {
      if (!ISSUE_KEY.test(v.duplicateOf)) throw new UserError("Type the key of the bug it duplicates, like OB-3921.");
      if (v.duplicateOf === key) throw new UserError("A bug can't duplicate itself. Type the other bug's key.");
    }
    const existing = await db.bugAuditCheck.findUnique({ where: { auditId_issueKey: { auditId, issueKey: key } } });
    if (existing && claimLive(existing, new Date()) && existing.claimedById !== user.id) throw new UserError(`${existing.claimedBy.split(/\s+/)[0]} is checking ${key}.`);
    const client = await jiraOf(u.hub.id);
    const now = await inJira(() => editableNow(client, key));
    // Someone changed it in Jira while it was open here: say what, and let the person decide.
    if (!v.force && now.updated && v.seenUpdated && now.updated !== v.seenUpdated) {
      const theirs = fieldChanges(v.seen, now.editable);
      if (theirs.length) return { conflict: theirs, current: now.editable, updated: now.updated, movedTo: "", commented: false };
    }
    // The original must exist before anything is written, so a typo stops the save cleanly.
    if (v.outcome === "dupe") await titleOf(client, v.duplicateOf);
    const changes = fieldChanges(now.editable, v.edits);
    const fields: Record<string, unknown> = {};
    if (now.editable.summary.trim() !== v.edits.summary.trim()) fields.summary = v.edits.summary;
    if (now.editable.priority !== v.edits.priority && v.edits.priority) fields.priority = { name: v.edits.priority };
    if (changes.some((c) => c.startsWith("Components:"))) fields.components = v.edits.components.map((name) => ({ name }));
    if (changes.some((c) => c.startsWith("Affects version:"))) fields.versions = v.edits.versions.map((name) => ({ name }));
    // The label goes on every checked bug, so it drops off the audit's filter.
    await inJira(() => client.editIssue(key, { ...(Object.keys(fields).length ? { fields } : {}), update: { labels: [{ add: audit.label }] } }));
    if (v.outcome === "dupe") {
      await inJira(() => client.markDuplicate(key, v.duplicateOf));
      changes.push(`Duplicate of ${v.duplicateOf}`);
    }
    let movedTo = "";
    if (v.moveTo) {
      const move = (await inJira(() => client.transitions(key))).find((t) => t.id === v.moveTo);
      if (!move) throw new UserError("Jira won't move this bug that way any more. Pick the status again.");
      await inJira(() => client.transition(key, move.id));
      movedTo = move.to;
    }
    if (auditNeedsComment(v.outcome as never, v.note)) await inJira(() => client.addComment(key, auditComment({ clients: v.clients, build: v.build, note: v.note, by: me })));
    const done = { outcome: v.outcome, clients: v.clients, build: v.build, note: v.note, changes, movedTo, title: v.edits.summary, checkedById: user.id, checkedBy: me, checkedAt: new Date() };
    await db.bugAuditCheck.upsert({
      where: { auditId_issueKey: { auditId, issueKey: key } },
      create: { auditId, issueKey: key, claimedById: user.id, claimedBy: me, claimedAt: new Date(), ...done },
      update: done,
    });
    forgetAudit(auditId);
    revalidatePath(`/g/${audit.groupId}/bugs/audit`);
    return { conflict: null, current: null, updated: null, movedTo, commented: auditNeedsComment(v.outcome as never, v.note) };
  });
}
