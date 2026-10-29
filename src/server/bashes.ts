"use server";

import { after } from "next/server";
import { refreshCrownsFor } from "@/lib/crowns";
import { Prisma, type Severity } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { logSchema, parseAreas, phaseOf, plusOnesOf, sevRank, startSchema, type BashArea, type StartInput } from "@/lib/bash";
import { bashSummaryLine } from "@/lib/bash-summary";
import { BLANK_CHARTER, type SessionNote } from "@/lib/charter";
import { templateById } from "@/lib/charter-templates";
import { charterHome, teamTemplates } from "@/lib/charter-data";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireProjectAction, requireUser } from "@/lib/session";
import { channelNamesFor, esc, postBash } from "@/lib/slack";
import { jiraConfigFor } from "@/lib/umbrella";
import { createLocalDefect, fileJiraBug } from "./jira";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";

// Bug bashes (ver_93). Starting one makes a charter per area and one test run in a test
// cycle, so it counts like any run. People join, pick an area and log bugs in one line;
// whoever started it wraps up: bugs are filed, and each person's log is saved as their
// session on that area's charter.

const nameOf = (u: { name: string | null; email: string }) => u.name ?? u.email;

function refresh(homeKey: string, cycleKey?: string) {
  revalidatePath(`/p/${homeKey}`, "layout");
  if (cycleKey && cycleKey !== homeKey) revalidatePath(`/p/${cycleKey}`, "layout");
}

async function loadBash(bashId: string) {
  const bash = await db.bugBash.findUnique({
    where: { id: bashId },
    include: { project: { select: { id: true, key: true, name: true, groupId: true } }, run: { select: { id: true, number: true, projectId: true, project: { select: { id: true, key: true, name: true, platform: true, groupId: true } } } } },
  });
  if (!bash?.run) throw new UserError("That bug bash isn't here anymore.");
  return { ...bash, run: bash.run };
}

/** Anyone on the bash's test cycle can join and log. */
async function requireIn(bashId: string) {
  const bash = await loadBash(bashId);
  const { user, who } = await requireProjectAction(bash.run.projectId, "bash:join");
  return { bash, user, who };
}

/** Whoever started it wraps up, whatever their role; so can leads and admins. */
async function requireOwner(bashId: string) {
  const { bash, user, who } = await requireIn(bashId);
  if (bash.createdById !== user.id && !can(who, "run:manage")) throw new UserError(`Only ${bash.createdBy} (who started it) or a lead can do that.`);
  return { bash, user };
}

/** Start a bug bash: a charter per area, one run in the test cycle, and a Slack post. */
export async function startBugBash(homeId: string, input: StartInput) {
  return attempt(async () => {
    const user = await requireUser();
    const data = startSchema.parse(input);
    const home = await db.project.findUniqueOrThrow({ where: { id: homeId }, select: { id: true, key: true, name: true, groupId: true, hubOf: { select: { id: true } } } });
    // The run goes in the picked test cycle, else here: never a release's test cycle unless asked (ver_94).
    const cycles = home.hubOf ? await db.project.findMany({ where: { groupId: home.hubOf.id, archivedAt: null, id: { not: home.id } }, orderBy: { createdAt: "desc" }, select: { id: true } }) : [];
    const cycleId = data.cycleId && (data.cycleId === home.id || cycles.some((c) => c.id === data.cycleId)) ? data.cycleId : home.id;
    const { project: cycle } = await requireProjectAction(cycleId, "run:create");
    const library = home.id === cycle.id ? [cycle.id] : [cycle.id, home.id];
    const team = await teamTemplates((await charterHome(home)).id);
    const now = new Date();
    const startsAt = data.startsAt && new Date(data.startsAt) > now ? new Date(data.startsAt) : now;
    const endsAt = new Date(startsAt.getTime() + data.minutes * 60_000);
    const by = nameOf(user);

    const bash = await db.$transaction(
      async (tx) => {
        // One charter per area, in the Case library's "Bug bashes" folder, reused when the same area comes back.
        const folder = (await tx.folder.findFirst({ where: { projectId: home.id, parentId: null, name: "Bug bashes" } })) ?? (await tx.folder.create({ data: { projectId: home.id, parentId: null, name: "Bug bashes" } }));
        const areas: BashArea[] = [];
        for (const [i, a] of data.areas.entries()) {
          const tpl = a.template ? templateById(a.template, team) : null;
          const title = `${tpl ? `${tpl.name}: ` : "Bug bash: "}${a.name}`.slice(0, 300);
          const charter = { ...BLANK_CHARTER, explore: a.name, with: tpl?.with ?? "", discover: tpl?.discover ?? "bugs, confusing parts and anything that feels slow", minutes: data.minutes, prompts: tpl?.prompts ?? [] };
          const same = await tx.testCase.findFirst({ where: { projectId: home.id, folderId: folder.id, title, type: "EXPLORATORY", archived: false }, select: { id: true, currentVersion: true, versions: { orderBy: { version: "desc" }, take: 1, select: { charter: true } } } });
          let caseId = same?.id;
          if (same && JSON.stringify(same.versions[0]?.charter) !== JSON.stringify(charter)) {
            const version = same.currentVersion + 1;
            await tx.testCase.update({ where: { id: same.id }, data: { currentVersion: version, versions: { create: { version, title, preconditions: "", priority: "MEDIUM", type: "EXPLORATORY", tags: [], folderPath: "Bug bashes", steps: [], charter, authorId: user.id, authorName: by, changeNote: `Bug bash: ${data.name}` } } } });
          }
          if (!caseId) {
            const { caseSeq } = await tx.project.update({ where: { id: home.id }, data: { caseSeq: { increment: 1 } } });
            const created = await tx.testCase.create({
              data: {
                projectId: home.id,
                number: caseSeq,
                folderId: folder.id,
                title,
                type: "EXPLORATORY",
                currentVersion: 1,
                versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "EXPLORATORY", tags: [], folderPath: "Bug bashes", steps: [], charter, authorId: user.id, authorName: by, changeNote: `Made for the bug bash ${data.name}` } },
              },
            });
            caseId = created.id;
          }
          areas.push({ id: `a${i + 1}`, name: a.name, caseId, template: tpl?.id ?? null });
        }
        const entries = await buildEntries(tx, library, areas.map((a) => a.caseId), null);
        const { runSeq } = await tx.project.update({ where: { id: cycle.id }, data: { runSeq: { increment: 1 } } });
        const run = await tx.testRun.create({
          data: {
            projectId: cycle.id,
            number: runSeq,
            name: `Bug bash · ${data.name}`,
            kind: "bash",
            description: `${data.minutes}-minute bug bash, ${areas.length} ${areas.length === 1 ? "area" : "areas"}`,
            release: cycle.rcName,
            createdById: user.id,
            createdBy: by,
            entries: { create: entries.map(({ assigneeId, ...e }) => (void assigneeId, e)) },
          },
        });
        return tx.bugBash.create({
          data: { projectId: home.id, runId: run.id, name: data.name, release: cycle.rcName, minutes: data.minutes, startsAt, endsAt, areas: areas as Prisma.InputJsonValue, collectFirst: data.collectFirst, slack: data.slack, funExtras: data.funExtras, createdById: user.id, createdBy: by },
        });
      },
      { timeout: 60_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Started the bug bash ${data.name}`, project: { id: cycle.id, name: cycle.name, groupId: cycle.groupId } });
    let posted: string[] = [];
    if (data.slack && startsAt <= now) posted = await slackStart(bash.id);
    refresh(home.key, cycle.key);
    return { id: bash.id, key: home.key, posted };
  });
}

/** Post the start to Slack once, with Join the bash. Returns the channel names. */
async function slackStart(bashId: string) {
  const b = await db.bugBash.findUnique({ where: { id: bashId }, include: { project: { select: { key: true } }, run: { select: { projectId: true } } } });
  if (!b?.run || b.slackStartAt || !b.slack) return [];
  await db.bugBash.update({ where: { id: b.id }, data: { slackStartAt: new Date() } });
  const areas = parseAreas(b.areas);
  const n = await postBash(b.run.projectId, (base) => ({
    tone: "blue",
    title: `🐞 Bug bash · ${b.name} is on!`,
    lines: [`${b.minutes} minutes, ${areas.length} ${areas.length === 1 ? "area" : "areas"}: ${areas.map((a) => esc(a.name)).join(", ")}. Started by ${esc(b.createdBy)}.`],
    button: { label: "Join the bash", url: `${base}/p/${b.project.key}/bashes/${b.id}/join` },
  }));
  if (!n) return [];
  return channelNamesFor(b.run.projectId);
}

/**
 * Things that happen on the clock, done when anyone looks (ver_93): a scheduled bash
 * posts its start, and ten minutes before the end the warning goes out.
 */
export async function bashTick(bashId: string) {
  const b = await db.bugBash.findUnique({ where: { id: bashId }, include: { project: { select: { key: true } }, run: { select: { projectId: true } }, _count: { select: { items: { where: { kind: "bug", mergedIntoId: null } } } } } });
  if (!b?.run || !b.slack) return;
  const phase = phaseOf(b);
  if (phase === "live" && !b.slackStartAt) await slackStart(b.id).catch(() => {});
  const left = b.endsAt.getTime() - Date.now();
  if (phase === "live" && b.minutes > 15 && left <= 10 * 60_000 && left > 0 && !b.slackWarnAt) {
    const claimed = await db.bugBash.updateMany({ where: { id: b.id, slackWarnAt: null }, data: { slackWarnAt: new Date() } });
    if (claimed.count)
      await postBash(b.run.projectId, (base) => ({
        tone: "amber",
        title: `⏰ 10 minutes left in the bug bash · ${b.name}`,
        lines: [`${b._count.items} ${b._count.items === 1 ? "bug" : "bugs"} so far. Log what you've got!`],
        button: { label: "Open the bash", url: `${base}/p/${b.project.key}/bashes/${b.id}` },
      })).catch(() => {});
  }
}

/** Join, or switch area: pick an area and start exploring. */
export async function joinBash(bashId: string, areaId: string) {
  return attempt(async () => {
    const { bash, user } = await requireIn(bashId);
    if (!parseAreas(bash.areas).some((a) => a.id === areaId)) throw new UserError("That area isn't in this bash.");
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is over and wrapped up.");
    await db.bashPerson.upsert({ where: { bashId_userId: { bashId, userId: user.id } }, create: { bashId, userId: user.id, name: nameOf(user), areaId }, update: { areaId } });
    refresh(bash.project.key);
    return {};
  });
}

/** Log a bug (or question, note, idea). Straight-to-Jira bashes file bugs right away. */
export async function logBashItem(bashId: string, input: z.input<typeof logSchema>) {
  return attempt(async () => {
    const { bash, user } = await requireIn(bashId);
    const data = logSchema.parse(input);
    const phase = phaseOf(bash);
    if (phase === "wrapped") throw new UserError("This bash is wrapped up. Log it as a regular bug instead.");
    if (phase === "scheduled") throw new UserError("This bash hasn't started yet.");
    const me = await db.bashPerson.findUnique({ where: { bashId_userId: { bashId, userId: user.id } } });
    if (!me) throw new UserError("Pick an area first.");
    const item = await db.bashItem.create({ data: { bashId, areaId: me.areaId, kind: data.kind, text: data.text, details: data.details, severity: data.severity as Severity, byId: user.id, byName: nameOf(user) } });
    if (data.attachmentIds.length) await db.attachment.updateMany({ where: { id: { in: data.attachmentIds }, projectId: bash.run.projectId, uploadedById: user.id, resultId: null }, data: { bashItemId: item.id } });
    let filed: string | null = null;
    if (!bash.collectFirst && data.kind === "bug") filed = await fileItem(bash, item.id).catch((e) => (e instanceof UserError ? `Logged here, but filing failed: ${e.message}` : null));
    refresh(bash.project.key);
    if (data.kind === "bug") after(() => refreshCrownsFor(bash.projectId));
    return { id: item.id, filed };
  });
}

/** "+1, I see it too" (or take it back). */
export async function plusOneBash(itemId: string, on: boolean) {
  return attempt(async () => {
    const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true, byId: true, plusOnes: true } });
    if (!item) throw new UserError("That bug isn't here anymore.");
    const { bash, user } = await requireIn(item.bashId);
    if (item.byId === user.id) throw new UserError("That's your own bug.");
    const others = plusOnesOf(item.plusOnes).filter((p) => p.id !== user.id);
    await db.bashItem.update({ where: { id: itemId }, data: { plusOnes: (on ? [...others, { id: user.id, name: nameOf(user) }] : others) as Prisma.InputJsonValue } });
    refresh(bash.project.key);
    return {};
  });
}

/** Remove your own line while the bash is on. */
export async function deleteBashItem(itemId: string) {
  return attempt(async () => {
    const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true, byId: true, defectId: true } });
    if (!item) throw new UserError("That line is already gone.");
    const { bash, user } = await requireIn(item.bashId);
    if (item.byId !== user.id) throw new UserError("Only whoever logged it can remove it.");
    if (item.defectId) throw new UserError("It's already filed, so it stays.");
    await db.bashItem.delete({ where: { id: itemId } });
    refresh(bash.project.key);
    return {};
  });
}

/** A prompt in this person's area ticked or unticked. */
export async function coverBashPrompt(bashId: string, prompt: string, on: boolean) {
  return attempt(async () => {
    const { bash, user } = await requireIn(bashId);
    const me = await db.bashPerson.findUnique({ where: { bashId_userId: { bashId, userId: user.id } } });
    if (!me) throw new UserError("Pick an area first.");
    const text = z.string().trim().min(1).max(300).parse(prompt);
    if (on) {
      const had = await db.bashItem.findFirst({ where: { bashId, areaId: me.areaId, kind: "covered", text, byId: user.id } });
      if (!had) await db.bashItem.create({ data: { bashId, areaId: me.areaId, kind: "covered", text, byId: user.id, byName: nameOf(user) } });
    } else await db.bashItem.deleteMany({ where: { bashId, areaId: me.areaId, kind: "covered", text, byId: user.id } });
    refresh(bash.project.key);
    return {};
  });
}

export async function endBashEarly(bashId: string) {
  return attempt(async () => {
    const { bash, user } = await requireOwner(bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("It's already wrapped up.");
    await db.bugBash.update({ where: { id: bashId }, data: { endedAt: new Date() } });
    await logActivity({ actor: user, kind: "run", action: `Ended the bug bash ${bash.name} early`, project: bash.run.project });
    refresh(bash.project.key);
    return {};
  });
}

const reviewSchema = z.object({ review: z.enum(["file", "skip"]).optional(), severity: z.enum(["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR"]).optional() });

/** Wrap-up list: Will file / Skip, and severity. */
export async function reviewBashItem(itemId: string, input: z.input<typeof reviewSchema>) {
  return attempt(async () => {
    const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true } });
    if (!item) throw new UserError("That bug isn't here anymore.");
    const { bash } = await requireOwner(item.bashId);
    const data = reviewSchema.parse(input);
    await db.bashItem.update({ where: { id: itemId }, data: { ...(data.review && { review: data.review }), ...(data.severity && { severity: data.severity }) } });
    refresh(bash.project.key);
    return {};
  });
}

/** Merge selected: the first (worst) keeps its line; the rest become its +1s. */
export async function mergeBashItems(itemIds: string[]) {
  return attempt(async () => {
    const ids = z.array(z.string()).min(2, "Tick two or more bugs to merge.").max(50).parse(itemIds);
    const items = await db.bashItem.findMany({ where: { id: { in: ids }, kind: "bug", mergedIntoId: null, defectId: null } });
    if (items.length < 2) throw new UserError("Tick two or more bugs that aren't filed yet.");
    const bashId = items[0].bashId;
    if (items.some((i) => i.bashId !== bashId)) throw new UserError("Those bugs are from different bashes.");
    const { bash } = await requireOwner(bashId);
    const [keep, ...rest] = [...items].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.createdAt.getTime() - b.createdAt.getTime());
    const people = new Map(plusOnesOf(keep.plusOnes).map((p) => [p.id, p]));
    for (const r of rest) {
      if (r.byId && r.byId !== keep.byId) people.set(r.byId, { id: r.byId, name: r.byName });
      for (const p of plusOnesOf(r.plusOnes)) if (p.id !== keep.byId) people.set(p.id, p);
    }
    await db.$transaction([
      db.bashItem.update({ where: { id: keep.id }, data: { plusOnes: [...people.values()] as Prisma.InputJsonValue, details: [keep.details, ...rest.map((r) => `Also logged by ${r.byName}: ${r.text}${r.details ? `\n${r.details}` : ""}`)].filter(Boolean).join("\n\n").slice(0, 5000) } }),
      db.bashItem.updateMany({ where: { id: { in: rest.map((r) => r.id) } }, data: { mergedIntoId: keep.id, review: "skip" } }),
      db.attachment.updateMany({ where: { bashItemId: { in: rest.map((r) => r.id) } }, data: { bashItemId: keep.id } }),
    ]);
    refresh(bash.project.key);
    return { into: keep.id };
  });
}

/** One person's lines in one area, as a session log. */
function logOf(items: { id: string; kind: string; text: string; details: string; createdAt: Date; attachments: { id: string; fileName: string; contentType: string }[] }[], startsAt: Date): SessionNote[] {
  return items.map((i) => ({
    id: `b${i.id}`,
    at: Math.max(0, Math.round((i.createdAt.getTime() - startsAt.getTime()) / 1000)),
    kind: (i.kind === "covered" ? "covered" : ["bug", "question", "note", "idea"].includes(i.kind) ? i.kind : "note") as SessionNote["kind"],
    text: [i.text, i.details].filter(Boolean).join("\n").slice(0, 10000),
    attachments: i.attachments.slice(0, 20),
    defect: null,
  }));
}

/** File one logged bug: to Jira when connected, else as a bug here. Returns the key. */
async function fileItem(bash: Awaited<ReturnType<typeof loadBash>>, itemId: string): Promise<string> {
  const item = await db.bashItem.findUniqueOrThrow({ where: { id: itemId }, include: { attachments: { select: { id: true } } } });
  if (item.defectId) return "";
  const areas = parseAreas(bash.areas);
  const area = areas.find((a) => a.id === item.areaId);
  const entry = await db.runEntry.findFirst({ where: { runId: bash.run.id, caseId: area?.caseId ?? "" }, select: { id: true } });
  if (!entry) throw new UserError("That area's charter isn't in the run anymore.");
  const seen = plusOnesOf(item.plusOnes);
  const actual = [
    item.details || item.text,
    `Found in the bug bash ${bash.name}, area ${area?.name ?? ""}, by ${item.byName}${seen.length ? `. Also seen by ${seen.map((p) => p.name).join(", ")}` : ""}.`,
  ].join("\n\n");
  let defectId: string, key: string;
  if (await jiraConfigFor(bash.run.projectId)) {
    const r = await fileJiraBug(bash.run.projectId, entry.id, { summary: item.text.slice(0, 250), severity: item.severity, stepIndex: null, actual, attachmentIds: item.attachments.map((a) => a.id) });
    if (!r.ok) throw new UserError(r.error);
    defectId = r.defect.id;
    key = r.defect.externalKey ?? `D-${r.defect.number}`;
  } else {
    const r = await createLocalDefect(bash.run.projectId, { title: item.text, severity: item.severity });
    if (!r.ok) throw new UserError(r.error);
    defectId = r.defect.id;
    key = `D-${r.defect.number}`;
  }
  await db.bashItem.update({ where: { id: item.id }, data: { defectId } });
  return key;
}

/**
 * Wrap up: each person's lines become their session on the area's charter, the bugs
 * ticked File it go to Jira (or here), the run closes, and the summary goes to Slack.
 * If any bug won't file, nothing wraps (ver_94): the review screen shows why, and
 * Wrap up anyway (`anyway`) closes it without trying those bugs again.
 */
export async function wrapUpBash(bashId: string, anyway = false) {
  return attempt(async () => {
    const { bash, user } = await requireOwner(bashId);
    if (bash.wrappedAt) throw new UserError("It's already wrapped up.");
    if (phaseOf(bash) === "live" || phaseOf(bash) === "scheduled") await db.bugBash.update({ where: { id: bashId }, data: { endedAt: new Date() } });
    const areas = parseAreas(bash.areas);
    const items = await db.bashItem.findMany({ where: { bashId }, orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true, fileName: true, contentType: true } } } });
    const entries = await db.runEntry.findMany({ where: { runId: bash.run.id }, select: { id: true, caseId: true, caseVersion: true } });
    const people = await db.bashPerson.findMany({ where: { bashId } });

    // Bugs first, so each session's log can point at its filed bug.
    const errors: string[] = [];
    let filedCount = 0;
    for (const it of items.filter((i) => i.kind === "bug" && !i.mergedIntoId && i.review === "file" && !i.defectId && !(anyway && i.fileError))) {
      try {
        await fileItem(bash, it.id);
        filedCount++;
        if (it.fileError) await db.bashItem.update({ where: { id: it.id }, data: { fileError: "" } });
      } catch (e) {
        const why = e instanceof Error ? e.message : "It couldn't be filed.";
        errors.push(`${it.text}: ${why}`);
        await db.bashItem.update({ where: { id: it.id }, data: { fileError: why.slice(0, 1000) } });
      }
    }
    if (errors.length && !anyway) {
      refresh(bash.project.key, bash.run.project.key);
      return { filed: filedCount, errors, wrapped: false };
    }
    const filed = await db.bashItem.findMany({ where: { bashId, defectId: { not: null } }, select: { id: true, defectId: true } });
    const defectOf = new Map(filed.map((f) => [f.id, f.defectId!]));
    const defects = await db.defect.findMany({ where: { id: { in: [...defectOf.values()] } } });

    const now = new Date();
    const ended = bash.endedAt && bash.endedAt < bash.endsAt ? bash.endedAt : bash.endsAt;
    // Who to save a session for: everyone who joined an area or logged in it.
    const pairs = new Map<string, { userId: string | null; name: string; areaId: string }>();
    for (const p of people) pairs.set(`${p.userId}:${p.areaId}`, { userId: p.userId, name: p.name, areaId: p.areaId });
    for (const i of items) pairs.set(`${i.byId}:${i.areaId}`, { userId: i.byId, name: i.byName, areaId: i.areaId });
    await db.$transaction(
      async (tx) => {
        for (const p of pairs.values()) {
          const area = areas.find((a) => a.id === p.areaId);
          const entry = entries.find((e) => e.caseId === area?.caseId);
          if (!area || !entry) continue;
          const mine = items.filter((i) => i.areaId === p.areaId && i.byId === p.userId && !i.mergedIntoId);
          const log = logOf(mine, bash.startsAt).map((n) => {
            const d = defects.find((x) => x.id === defectOf.get(n.id.slice(1)));
            return d ? { ...n, defect: { id: d.id, number: d.number, title: d.title, externalKey: d.externalKey, externalUrl: d.externalUrl, status: d.externalStatus ?? d.status } } : n;
          });
          const bugs = mine.filter((i) => i.kind === "bug").length;
          const result = await tx.testResult.create({
            data: {
              entryId: entry.id,
              runId: bash.run.id,
              caseId: entry.caseId,
              caseVersion: entry.caseVersion,
              status: bugs ? "FAILED" : "PASSED",
              stepResults: [],
              comment: `Bug bash ${bash.name}: ${bugs} ${bugs === 1 ? "bug" : "bugs"} in ${area.name}.`,
              elapsedSec: Math.round((ended.getTime() - bash.startsAt.getTime()) / 1000),
              sessionLog: log as Prisma.InputJsonValue,
              testerId: p.userId,
              testerName: p.name,
              createdAt: now,
            },
          });
          for (const n of log) if (n.defect) await tx.defectLink.upsert({ where: { defectId_resultId: { defectId: n.defect.id, resultId: result.id } }, create: { defectId: n.defect.id, resultId: result.id, stepIndex: null }, update: {} });
          const ids = mine.flatMap((i) => i.attachments.map((a) => a.id));
          if (ids.length) await tx.attachment.updateMany({ where: { id: { in: ids } }, data: { resultId: result.id } });
          const areaBugs = items.some((i) => i.areaId === p.areaId && i.kind === "bug" && !i.mergedIntoId);
          await tx.runEntry.update({ where: { id: entry.id }, data: { status: areaBugs ? "FAILED" : "PASSED", lastTestedAt: now } });
        }
        // Areas nobody explored stay Untested; the run closes either way.
        await tx.testRun.update({ where: { id: bash.run.id }, data: { state: "COMPLETED", completedAt: now } });
        await tx.bugBash.update({ where: { id: bashId }, data: { wrappedAt: now } });
      },
      { timeout: 60_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Wrapped up the bug bash ${bash.name}`, project: bash.run.project, detail: `${filedCount} bugs filed` });
    if (bash.slack && !bash.slackDoneAt) {
      await db.bugBash.update({ where: { id: bashId }, data: { slackDoneAt: new Date() } });
      const line = await bashSummaryLine(bashId);
      await postBash(bash.run.projectId, (base) => ({ tone: "green", title: `🐞 Bug bash · ${bash.name} is done.`, lines: [line], button: { label: "See the report", url: `${base}/p/${bash.project.key}/bashes/${bashId}/report` } })).catch(() => {});
    }
    refresh(bash.project.key, bash.run.project.key);
    return { filed: filedCount, errors, wrapped: true };
  });
}

/**
 * File this bug… (ver_94): a bash bug filed later from the usual bug box, at wrap-up or
 * from the report. Records the bug on the item and, once wrapped, on the finder's session.
 */
export async function bashBugFiled(itemId: string, defectId: string) {
  return attempt(async () => {
    const item = await db.bashItem.findUniqueOrThrow({ where: { id: itemId }, select: { id: true, bashId: true, kind: true, areaId: true, byId: true, defectId: true } });
    const { bash } = await requireOwner(item.bashId);
    if (item.kind !== "bug") throw new UserError("Only bugs can be filed.");
    const defect = await db.defect.findUnique({ where: { id: defectId }, select: { id: true } });
    if (!defect) throw new UserError("That bug wasn't found.");
    await db.bashItem.update({ where: { id: item.id }, data: { defectId: defect.id, fileError: "", review: "file" } });
    if (bash.wrappedAt) {
      const area = parseAreas(bash.areas).find((a) => a.id === item.areaId);
      const entry = await db.runEntry.findFirst({ where: { runId: bash.run.id, caseId: area?.caseId ?? "" }, select: { id: true } });
      const result = entry ? await db.testResult.findFirst({ where: { entryId: entry.id, ...(item.byId ? { testerId: item.byId } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null;
      if (result) await db.defectLink.upsert({ where: { defectId_resultId: { defectId: defect.id, resultId: result.id } }, create: { defectId: defect.id, resultId: result.id, stepIndex: null }, update: {} });
    }
    refresh(bash.project.key, bash.run.project.key);
    return {};
  });
}

/** Share → Post to Slack: the summary card again, for a channel that missed it. */
export async function postBashReport(bashId: string) {
  return attempt(async () => {
    const { bash } = await requireIn(bashId);
    const line = await bashSummaryLine(bashId);
    const n = await postBash(bash.run.projectId, (base) => ({ tone: "green", title: `🐞 Bug bash · ${bash.name}`, lines: [line], button: { label: "See the report", url: `${base}/p/${bash.project.key}/bashes/${bashId}/report` } }));
    if (!n) throw new UserError("This test cycle doesn't post to Slack yet. Add a channel in Settings → Slack alerts.");
    return { channels: n };
  });
}
