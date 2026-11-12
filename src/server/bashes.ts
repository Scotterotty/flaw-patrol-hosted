"use server";

import { after } from "next/server";
import { refreshCrownsFor } from "@/lib/crowns";
import { Prisma, type Severity } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { areaNameSchema, cleanPlatform, cleanPlatforms, onPlatform, linkSchema, logSchema, matchRelease, parseAreas, seenSchema, valuesSchema, parseLinks, phaseOf, plusOnesOf, setupLine, setupSchema, sevRank, startSchema, webLink, type BashArea, type BashLink, type StartInput } from "@/lib/bash";
import { open } from "@/lib/crypto";
import { GitHubClient } from "@/lib/github";
import { jiraFor } from "@/lib/jira";
import { storiesConfigFor } from "@/lib/stories";
import { bashSummaryLine } from "@/lib/bash-summary";
import { BLANK_CHARTER, type SessionNote } from "@/lib/charter";
import { templateById } from "@/lib/charter-templates";
import { charterHome, teamTemplates } from "@/lib/charter-data";
import { db } from "@/lib/db";
import { can, type Who } from "@/lib/permissions";
import { Forbidden, requireProjectAction, requireUser } from "@/lib/session";
import { bashGuestOk } from "@/lib/link-access-server";
import { bashEnded, channelNamesFor, esc, postBash } from "@/lib/slack";
import { jiraConfigFor } from "@/lib/umbrella";
import { bashReleases, startBoxData } from "@/lib/bash-data";
import { createLocalDefect, fileJiraBug, fileTemplatedBug, previewFoundIn } from "./jira";
import { bugContext } from "@/lib/bug-context";
import { sectionText } from "@/lib/jira-format";
import { listWords, nowCell, parseLayout, type AutoCells } from "@/lib/bug-layout";
import { templateHome } from "@/lib/bug-templates-data";
import { bashAnswers, isNeedsLine, itemTemplate, mergeValues, needsLine, needsOf, withoutSeenRow, withSeenRow, type BashValues } from "@/lib/bash-template";
import { MAX_AHEAD_MS } from "@/lib/bash-schedule";
import { CANT_REPRODUCE, OKO_FORM, okoStart, withOko, type BashOko } from "@/lib/bash-oko";
import { bashOkoFor } from "@/lib/bash-oko-data";
import { FIELD, optionLike, type TemplateBug } from "@/lib/bug-template";
import { okoIntoDraft } from "@/lib/oko-draft";
import { mailOn, sendMail } from "@/lib/mail";
import { origin } from "@/lib/slack";
import { attempt, UserError } from "./result";
import { buildEntries } from "./snapshot";

// Bug bashes. Starting one makes a charter per area and one test run in a test
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
    include: { project: { select: { id: true, key: true, name: true, groupId: true } }, run: { select: { id: true, number: true, projectId: true, build: true, environment: true, project: { select: { id: true, key: true, name: true, platform: true, groupId: true } } } } },
  });
  if (!bash?.run) throw new UserError("That bug bash isn't here anymore.");
  return { ...bash, run: bash.run };
}

/**
 * Anyone on the bash's test cycle can join and log. So can anyone signed in while it's on,
 * and people who took part: they act like a Viewer inside this bash only.
 */
async function requireIn(bashId: string) {
  const bash = await loadBash(bashId);
  try {
    const { user, who } = await requireProjectAction(bash.run.projectId, "bash:join");
    return { bash, user, who };
  } catch (e) {
    if (!(e instanceof Forbidden)) throw e;
    const user = await requireUser();
    if (!(await bashGuestOk(bashId, user.id))) throw e;
    const who: Who = { role: "VIEWER", rules: null };
    return { bash, user, who };
  }
}

/** Whoever started it wraps up, whatever their role; so can leads and admins. */
async function requireOwner(bashId: string) {
  const { bash, user, who } = await requireIn(bashId);
  if (bash.createdById !== user.id && !can(who, "run:manage")) throw new UserError(`Only ${bash.createdBy} (who started it) or a lead can do that.`);
  return { bash, user };
}

/** A bug template from the umbrella (or test cycle) a bash's run belongs to, or null. */
async function bashTemplate(runProjectId: string, id: string | null) {
  if (!id) return null;
  const project = await db.project.findUniqueOrThrow({ where: { id: runProjectId }, select: { id: true, key: true, groupId: true } });
  const home = await templateHome(project);
  const t = await db.bugTemplate.findFirst({ where: { id, projectId: home.id }, select: { id: true, name: true, layout: true } });
  if (!t) throw new UserError("That bug template is gone. Someone may have deleted it. Pick another one.");
  return { id: t.id, name: t.name, layout: parseLayout(t.layout) };
}

/** The run's details and a person's automatic table cells, for a bug in this area. */
async function bashFill(bash: Awaited<ReturnType<typeof loadBash>>, areaId: string, who: string, seen?: z.input<typeof seenSchema>, platform = "") {
  const area = parseAreas(bash.areas).find((a) => a.id === areaId);
  const entry = await db.runEntry.findFirst({ where: { runId: bash.run.id, caseId: area?.caseId ?? "" }, select: { id: true } });
  const ctx = entry ? (await bugContext(bash.run.projectId, entry.id, null, "")).ctx : null;
  const s = seenSchema.parse(seen ?? {});
  const auto: AutoCells = {
    now: s.now || nowCell(),
    build: [ctx?.build, ctx?.fields?.find((f) => /csp/i.test(f.name))?.value].filter(Boolean).join(" · ") || ctx?.release || "",
    // The platform the person said they're on leads (ver_146); the run's environment follows.
    env: [platform, ctx?.environment].filter(Boolean).join(" · "),
    device: s.device,
    who,
  };
  return { env: [platform && `Platform: ${platform}`, ctx ? sectionText("env", ctx) : ""].filter(Boolean).join("\n"), auto };
}

type Tx = Prisma.TransactionClient;

/** The Case library's "Bug bashes" folder, made the first time. */
async function bashFolder(tx: Tx, homeId: string) {
  return (await tx.folder.findFirst({ where: { projectId: homeId, parentId: null, name: "Bug bashes" } })) ?? (await tx.folder.create({ data: { projectId: homeId, parentId: null, name: "Bug bashes" } }));
}

/** One charter per area, in the "Bug bashes" folder, reused when the same area comes back. Returns its case id. */
async function areaCharter(
  tx: Tx,
  o: { homeId: string; folderId: string; name: string; tpl: ReturnType<typeof templateById> | null; minutes: number; bashName: string; user: { id: string }; by: string },
) {
  const { tpl } = o;
  const title = `${tpl ? `${tpl.name}: ` : "Bug bash: "}${o.name}`.slice(0, 300);
  const charter = { ...BLANK_CHARTER, explore: o.name, with: tpl?.with ?? "", discover: tpl?.discover ?? "bugs, confusing parts and anything that feels slow", minutes: o.minutes, prompts: tpl?.prompts ?? [] };
  const same = await tx.testCase.findFirst({ where: { projectId: o.homeId, folderId: o.folderId, title, type: "EXPLORATORY", archived: false }, select: { id: true, currentVersion: true, versions: { orderBy: { version: "desc" }, take: 1, select: { charter: true } } } });
  if (same) {
    if (JSON.stringify(same.versions[0]?.charter) !== JSON.stringify(charter)) {
      const version = same.currentVersion + 1;
      await tx.testCase.update({ where: { id: same.id }, data: { currentVersion: version, versions: { create: { version, title, preconditions: "", priority: "MEDIUM", type: "EXPLORATORY", tags: [], folderPath: "Bug bashes", steps: [], charter, authorId: o.user.id, authorName: o.by, changeNote: `Bug bash: ${o.bashName}` } } } });
    }
    return same.id;
  }
  const { caseSeq } = await tx.project.update({ where: { id: o.homeId }, data: { caseSeq: { increment: 1 } } });
  const created = await tx.testCase.create({
    data: {
      projectId: o.homeId,
      number: caseSeq,
      folderId: o.folderId,
      title,
      type: "EXPLORATORY",
      currentVersion: 1,
      versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "EXPLORATORY", tags: [], folderPath: "Bug bashes", steps: [], charter, authorId: o.user.id, authorName: o.by, changeNote: `Made for the bug bash ${o.bashName}` } },
    },
  });
  return created.id;
}

/** Start a bug bash: a charter per area, one run in the test cycle, and a Slack post. */
/** The Start a bug bash box's area ideas and choices, fetched when the box opens or is about to. */
export async function startBoxFor(projectId: string) {
  return attempt(async () => {
    const { project } = await requireProjectAction(projectId, "run:create");
    return { data: await startBoxData(project) };
  });
}

export async function startBugBash(homeId: string, input: StartInput) {
  return attempt(async () => {
    const user = await requireUser();
    const data = startSchema.parse(input);
    const home = await db.project.findUniqueOrThrow({ where: { id: homeId }, select: { id: true, key: true, name: true, groupId: true, hubOf: { select: { id: true } } } });
    // The run goes in the picked test cycle, else here: never a release's test cycle unless asked.
    const cycles = home.hubOf ? await db.project.findMany({ where: { groupId: home.hubOf.id, archivedAt: null, id: { not: home.id } }, orderBy: { createdAt: "desc" }, select: { id: true } }) : [];
    const cycleId = data.cycleId && (data.cycleId === home.id || cycles.some((c) => c.id === data.cycleId)) ? data.cycleId : home.id;
    const { project: cycle } = await requireProjectAction(cycleId, "run:create");
    // A release picked by name (ver_152): the run stays here, on every platform the bash lists.
    const release = cycle.id === home.id ? matchRelease(data.release, await bashReleases(home)) : cycle.rcName;
    const bugTemplate = await bashTemplate(cycle.id, data.bugTemplateId);
    const library = home.id === cycle.id ? [cycle.id] : [cycle.id, home.id];
    const team = await teamTemplates((await charterHome(home)).id);
    const now = new Date();
    const startsAt = data.startsAt && new Date(data.startsAt) > now ? new Date(data.startsAt) : now;
    if (startsAt.getTime() - now.getTime() > MAX_AHEAD_MS) throw new UserError("Pick a start time within the next year.");
    const endsAt = new Date(startsAt.getTime() + data.minutes * 60_000);
    const by = nameOf(user);
    // What people are testing (ver_172): one link for the whole bash, any web page, PR or Jira issue.
    const link = data.link ? webLink(data.link) : null;
    if (data.link && !link) throw new UserError("The link needs to start with http:// or https://, like https://staging.example.com.");

    const bash = await db.$transaction(
      async (tx) => {
        const folder = await bashFolder(tx, home.id);
        const areas: BashArea[] = [];
        for (const [i, a] of data.areas.entries()) {
          const tpl = a.template ? templateById(a.template, team) : null;
          const caseId = await areaCharter(tx, { homeId: home.id, folderId: folder.id, name: a.name, tpl, minutes: data.minutes, bashName: data.name, user, by });
          areas.push({ id: `a${i + 1}`, name: a.name, caseId, template: tpl?.id ?? null, links: a.links });
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
            release,
            build: data.build,
            environment: data.environment,
            createdById: user.id,
            createdBy: by,
            entries: { create: entries.map(({ assigneeId, ...e }) => (void assigneeId, e)) },
          },
        });
        return tx.bugBash.create({
          data: { projectId: home.id, runId: run.id, name: data.name, release, minutes: data.minutes, startsAt, endsAt, areas: areas as Prisma.InputJsonValue, collectFirst: data.collectFirst, slack: data.slack, funExtras: data.funExtras, bugTemplateId: bugTemplate?.id ?? null, platforms: cleanPlatforms(data.platforms), links: (link ? [link] : []) as Prisma.InputJsonValue, createdById: user.id, createdBy: by },
        });
      },
      { timeout: 60_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Started the bug bash ${data.name}`, project: { id: cycle.id, name: cycle.name, groupId: cycle.groupId } });
    let posted: string[] = [];
    if (data.slack && startsAt <= now) posted = await slackStart(bash.id);
    // Scheduled ahead (ver_153): a heads-up now, and the start post with Join when it opens.
    else if (data.slack) posted = await slackSoon(bash.id, "soon");
    refresh(home.key, cycle.key);
    return { id: bash.id, key: home.key, posted, by };
  });
}

/** Post the start to Slack once, with Join the bash. Returns the channel names. */
async function slackStart(bashId: string) {
  const b = await db.bugBash.findUnique({ where: { id: bashId }, include: { project: { select: { key: true } }, run: { select: { projectId: true, build: true, environment: true } } } });
  if (!b?.run || b.slackStartAt || !b.slack) return [];
  // Claim the start in one step so two people opening the page at once can't both post it.
  const claimed = await db.bugBash.updateMany({ where: { id: b.id, slackStartAt: null }, data: { slackStartAt: new Date() } });
  if (!claimed.count) return [];
  const areas = parseAreas(b.areas);
  const n = await postBash(b.run.projectId, (base) => ({
    tone: "blue",
    title: `🐞 Bug bash · ${b.name} is on!`,
    lines: [`${b.minutes} minutes, ${areas.length} ${areas.length === 1 ? "area" : "areas"}: ${areas.map((a) => esc(a.name)).join(", ")}. Started by ${esc(b.createdBy)}.`, ...setupLines(b.run!, parseLinks(b.links))],
    button: { label: "Join the bash", url: `${base}/p/${b.project.key}/bashes/${b.id}?join=1` },
  }));
  if (!n) return [];
  return channelNamesFor(b.run.projectId);
}

/** "Build 2.4.1 on Staging" and the link to what's being tested, for Slack (ver_172). */
function setupLines(run: { build: string; environment: string }, links: BashLink[]) {
  const line = setupLine(run);
  const web = links.find((l) => l.url);
  return [line && `${esc(line)}.`, web && `Testing: <${web.url}|${esc(web.title || web.key)}>`].filter((x): x is string => !!x);
}

/** Slack's own date token, so each person reads the time on their own clock. */
const slackWhen = (d: Date) => `<!date^${Math.floor(d.getTime() / 1000)}^{date_short_pretty} at {time}|${d.toUTCString().replace(/:00 GMT$/, " UTC")}>`;

/** A scheduled bash's heads-up, its new time, or that it's off. Returns the channel names. */
async function slackSoon(bashId: string, what: "soon" | "moved" | "cancelled", b0?: { name: string; startsAt: Date; minutes: number; createdBy: string; areas: Prisma.JsonValue; projectKey: string; runProjectId: string; setup?: string[] }) {
  const found = b0 ? null : await db.bugBash.findUnique({ where: { id: bashId }, include: { project: { select: { key: true } }, run: { select: { projectId: true, build: true, environment: true } } } });
  const b = b0 ?? (found?.run && found.slack ? { name: found.name, startsAt: found.startsAt, minutes: found.minutes, createdBy: found.createdBy, areas: found.areas, projectKey: found.project.key, runProjectId: found.run.projectId, setup: setupLines(found.run, parseLinks(found.links)) } : null);
  if (!b) return [];
  const areas = parseAreas(b.areas);
  const n = await postBash(b.runProjectId, (base) =>
    what === "cancelled"
      ? { tone: "amber", title: `Bug bash · ${esc(b.name)} is cancelled`, lines: [`It was set for ${slackWhen(b.startsAt)}. Cancelled by ${esc(b.createdBy)}.`] }
      : {
          tone: "blue",
          title: what === "moved" ? `📅 Bug bash · ${esc(b.name)} has a new time` : `📅 Bug bash · ${esc(b.name)} is coming up`,
          lines: [`Starts ${slackWhen(b.startsAt)}, for ${b.minutes} minutes. ${areas.length} ${areas.length === 1 ? "area" : "areas"}: ${areas.map((a) => esc(a.name)).join(", ")}. Set up by ${esc(b.createdBy)}.`, ...(b.setup ?? [])],
          button: { label: "See the bash", url: `${base}/p/${b.projectKey}/bashes/${bashId}` },
        },
  );
  if (!n) return [];
  return channelNamesFor(b.runProjectId);
}

/** Move a bash that hasn't started yet to a new time (ver_153). Same length. */
export async function rescheduleBash(bashId: string, startsAtIso: string) {
  return attempt(async () => {
    const { bash, user } = await requireOwner(bashId);
    if (phaseOf(bash) !== "scheduled") throw new UserError("It has already started, so its time can't change now.");
    const startsAt = new Date(z.string().max(40).parse(startsAtIso));
    const now = new Date();
    if (Number.isNaN(startsAt.getTime()) || startsAt <= now) throw new UserError("That time has already passed. Pick a later one.");
    if (startsAt.getTime() - now.getTime() > MAX_AHEAD_MS) throw new UserError("Pick a start time within the next year.");
    const endsAt = new Date(startsAt.getTime() + bash.minutes * 60_000);
    await db.bugBash.update({ where: { id: bashId }, data: { startsAt, endsAt } });
    await logActivity({ actor: user, kind: "run", action: `Moved the bug bash ${bash.name} to a new time`, project: bash.run.project });
    if (bash.slack) await slackSoon(bashId, "moved").catch(() => {});
    refresh(bash.project.key, bash.run.project.key);
    return {};
  });
}

/** Call off a bash before it starts (ver_153): the bash and its empty run go. Nothing was logged yet. */
export async function cancelBash(bashId: string) {
  return attempt(async () => {
    const { bash, user } = await requireOwner(bashId);
    if (phaseOf(bash) !== "scheduled") throw new UserError("It has already started. End it early instead.");
    await db.$transaction([db.bugBash.delete({ where: { id: bashId } }), db.testRun.delete({ where: { id: bash.run.id } })]);
    await logActivity({ actor: user, kind: "run", action: `Cancelled the bug bash ${bash.name}`, project: bash.run.project });
    if (bash.slack) await slackSoon(bashId, "cancelled", { name: bash.name, startsAt: bash.startsAt, minutes: bash.minutes, createdBy: nameOf(user), areas: bash.areas, projectKey: bash.project.key, runProjectId: bash.run.projectId }).catch(() => {});
    refresh(bash.project.key, bash.run.project.key);
    return { homeKey: bash.project.key };
  });
}

/**
 * Things that happen on the clock, done when anyone looks: a scheduled bash
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

/**
 * Join, or switch area or platform: pick an area and start exploring. The platform is
 * optional (ver_146): left out keeps what you said before, "" means you'd rather not say.
 */
export async function joinBash(bashId: string, areaId: string, platform?: string) {
  return attempt(async () => {
    const { bash, user } = await requireIn(bashId);
    if (!parseAreas(bash.areas).some((a) => a.id === areaId)) throw new UserError("That area isn't in this bash.");
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is over and wrapped up.");
    const p = platform === undefined ? undefined : cleanPlatform(platform);
    await db.bashPerson.upsert({ where: { bashId_userId: { bashId, userId: user.id } }, create: { bashId, userId: user.id, name: nameOf(user), areaId, platform: p ?? "" }, update: { areaId, ...(p !== undefined && { platform: p }) } });
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
    // A bug with a bug template keeps the template as it is now, and what was typed under it.
    const tpl = data.kind === "bug" ? await bashTemplate(bash.run.projectId, data.templateId) : null;
    // No template of its own in a cycle that files OKO bugs (ver_220): the OKO layout, with
    // Add for Jira's boxes (all optional) and what Flaw Patrol fills in.
    const oko = data.kind === "bug" && !tpl ? await bashOkoFor(bash.run.projectId) : null;
    let kept = {};
    if (tpl) {
      const fill = await bashFill(bash, me.areaId, nameOf(user), data.seen, me.platform);
      const answers = bashAnswers(tpl.layout, await ownFiles(data.values, bash.run.projectId, user.id), { env: fill.env, actual: data.details || data.text }, fill.auto);
      kept = { templateId: tpl.id, templateName: tpl.name, layout: tpl.layout as unknown as Prisma.InputJsonValue, answers: answers as unknown as Prisma.InputJsonValue };
    } else if (oko) {
      const fill = await bashFill(bash, me.areaId, nameOf(user), data.seen, me.platform);
      const t = okoStart(oko.layout, oko.defaults, { values: await ownFiles(data.values, bash.run.projectId, user.id), actual: [data.text, data.details].filter(Boolean).join("\n\n"), build: bash.run.build, env: fill.env, auto: fill.auto });
      kept = { templateId: null, templateName: OKO_FORM, layout: t.layout as unknown as Prisma.InputJsonValue, answers: t.answers as unknown as Prisma.InputJsonValue };
    }
    const item = await db.bashItem.create({ data: { bashId, areaId: me.areaId, kind: data.kind, text: data.text, details: data.details, severity: data.severity as Severity, byId: user.id, byName: nameOf(user), platform: me.platform, build: bash.run.build, environment: bash.run.environment, ...kept } });
    const fileIds = [...data.attachmentIds, ...Object.values(data.values).flatMap((v) => v.files.map((f) => f.id))];
    if (fileIds.length) await db.attachment.updateMany({ where: { id: { in: fileIds }, projectId: bash.run.projectId, uploadedById: user.id, resultId: null }, data: { bashItemId: item.id } });
    const needs = tpl || oko ? await itemNeeds(item.id, oko) : [];
    let filed: string | null = null;
    // Logging never waits on a template's must-haves (Scott, ver_125); filing does.
    if (!bash.collectFirst && data.kind === "bug" && needs.length) filed = `Logged. It goes to ${(await jiraConfigFor(bash.run.projectId)) ? "Jira" : "the bug list"} once ${listWords(needs)} ${needs.length === 1 ? "is" : "are"} added.`;
    else if (!bash.collectFirst && data.kind === "bug") filed = await fileItem(bash, item.id).catch((e) => (e instanceof UserError ? `Logged here, but filing failed: ${e.message}` : null));
    refresh(bash.project.key);
    if (data.kind === "bug") after(() => refreshCrownsFor(bash.projectId));
    return { id: item.id, filed, needs };
  });
}

/** Only files this person uploaded and nobody has used yet, named as stored. */
async function ownFiles(values: z.output<typeof valuesSchema>, projectId: string, userId: string): Promise<BashValues> {
  const ids = Object.values(values).flatMap((v) => v.files.map((f) => f.id));
  const ok = ids.length ? await db.attachment.findMany({ where: { id: { in: ids }, projectId, uploadedById: userId, resultId: null, defectId: null }, select: { id: true, fileName: true } }) : [];
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { text: v.text, files: v.files.flatMap((f) => ok.filter((x) => x.id === f.id)) }]));
}

/** What a templated bash bug still needs before it's filed (its files count as screenshots). */
async function itemNeeds(itemId: string, oko: BashOko | null) {
  const it = await db.bashItem.findUniqueOrThrow({ where: { id: itemId }, select: { kind: true, text: true, details: true, build: true, platform: true, defectId: true, templateName: true, layout: true, answers: true, attachments: { select: { fileName: true, contentType: true } } } });
  const t = itemTemplate(withOko(it, oko));
  return t ? needsOf(t.layout, t.answers, it.attachments, it.platform).words : [];
}

/**
 * Fill in: anyone in the bash adds what a bug's template still needs, from Live finds
 * or at wrap-up. A straight-to-Jira bash files the bug as soon as it has everything.
 */
export async function fillBashItem(itemId: string, input: { values: z.input<typeof valuesSchema>; attachmentIds?: string[] }) {
  return attempt(async () => {
    const raw = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true, kind: true, text: true, details: true, build: true, defectId: true, templateName: true, layout: true, answers: true, bash: { select: { run: { select: { projectId: true } } } } } });
    const oko = raw?.bash.run ? await bashOkoFor(raw.bash.run.projectId) : null;
    const it = raw ? withOko(raw, oko) : null;
    const t = it ? itemTemplate(it) : null;
    if (!it || !t) throw new UserError("That bug isn't here anymore.");
    const { bash, user } = await requireIn(it.bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up.");
    if (it.defectId) throw new UserError("It's already filed, so change it there.");
    const values = await ownFiles(valuesSchema.parse(input.values), bash.run.projectId, user.id);
    const answers = mergeValues(t.answers, t.layout, values);
    // A plain bug seen with the OKO layout keeps it from now on.
    await db.bashItem.update({ where: { id: itemId }, data: { answers: answers as unknown as Prisma.InputJsonValue, ...(!raw!.templateName && { templateName: t.name, layout: t.layout as unknown as Prisma.InputJsonValue }) } });
    const ids = [...z.array(z.string().max(40)).max(10).parse(input.attachmentIds ?? []), ...Object.values(values).flatMap((v) => v.files.map((f) => f.id))];
    if (ids.length) await db.attachment.updateMany({ where: { id: { in: ids }, projectId: bash.run.projectId, uploadedById: user.id, resultId: null, defectId: null }, data: { bashItemId: itemId } });
    const needs = await itemNeeds(itemId, oko);
    // Ready now: a hold-back from wrap-up no longer applies.
    if (!needs.length) await db.bashItem.updateMany({ where: { id: itemId, fileError: { startsWith: "Needs " } }, data: { fileError: "" } });
    let filed: string | null = null;
    if (!needs.length && !bash.collectFirst && phaseOf(bash) === "live") filed = await fileItem(bash, itemId).catch((e) => (e instanceof UserError ? `Saved, but filing failed: ${e.message}` : null));
    refresh(bash.project.key);
    return { needs, filed };
  });
}

/** Whoever started it switches the bug template while it's on. Bugs already logged keep theirs. */
export async function setBashTemplate(bashId: string, templateId: string | null) {
  return attempt(async () => {
    const { bash } = await requireOwner(bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up.");
    const t = await bashTemplate(bash.run.projectId, templateId);
    await db.bugBash.update({ where: { id: bashId }, data: { bugTemplateId: t?.id ?? null } });
    refresh(bash.project.key);
    return {};
  });
}

/**
 * Count a bash toward a release, or keep it on its own (ver_152). Whoever started it can,
 * and so can anyone who can start runs. The run gets the release too: that's what Release status reads.
 */
export async function setBashRelease(bashId: string, release: string) {
  return attempt(async () => {
    const { bash, user, who } = await requireIn(bashId);
    if (bash.createdById !== user.id && !can(who, "run:create")) throw new UserError(`Only ${bash.createdBy} (who started it) or someone who can start runs can change that.`);
    const want = z.string().trim().max(100).parse(release);
    const offered = [...(await bashReleases(bash.project)), ...(bash.release ? [bash.release] : [])];
    const picked = matchRelease(want, offered);
    if (want && !picked) throw new UserError(`${want} isn't a current release. Save it on a test cycle first.`);
    await db.$transaction([db.bugBash.update({ where: { id: bashId }, data: { release: picked } }), db.testRun.update({ where: { id: bash.run.id }, data: { release: picked } })]);
    refresh(bash.project.key, bash.run.project.key);
    return { release: picked };
  });
}

/** "+1, I see it too" (or take it back). With a growing table, it adds the person's own row. */
export async function plusOneBash(itemId: string, on: boolean, seen?: z.input<typeof seenSchema>) {
  return attempt(async () => {
    const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true, areaId: true, byId: true, plusOnes: true, defectId: true, templateName: true, layout: true, answers: true } });
    if (!item) throw new UserError("That bug isn't here anymore.");
    const { bash, user } = await requireIn(item.bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up, so +1s are closed.");
    if (item.byId === user.id) throw new UserError("That's your own bug.");
    const before = plusOnesOf(item.plusOnes);
    const others = before.filter((p) => p.id !== user.id);
    const t = itemTemplate(item);
    const had = before.length !== others.length;
    // Where they saw it too: the platform they said they're on, if any (ver_146).
    const platform = on ? ((await db.bashPerson.findUnique({ where: { bashId_userId: { bashId: item.bashId, userId: user.id } }, select: { platform: true } }))?.platform ?? "") : "";
    let answers = t?.answers;
    if (t && !item.defectId && t.answers.some((a) => a.growing)) {
      if (on && !had) answers = withSeenRow(t.answers, (await bashFill(bash, item.areaId, nameOf(user), seen, platform)).auto);
      if (!on && had) answers = withoutSeenRow(t.answers, nameOf(user));
    }
    await db.bashItem.update({ where: { id: itemId }, data: { plusOnes: (on ? [...others, { id: user.id, name: nameOf(user), ...(platform && { platform }) }] : others) as Prisma.InputJsonValue, ...(answers && t && answers !== t.answers && { answers: answers as unknown as Prisma.InputJsonValue }) } });
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
    await db.$transaction([db.bashItem.deleteMany({ where: { replyToId: itemId } }), db.bashItem.delete({ where: { id: itemId } })]);
    refresh(bash.project.key);
    return {};
  });
}

const addSchema = z.string().trim().min(1, "Type what to add.").max(1000);

/**
 * Add to it / Answer: one line on someone's find, like "Also on Safari" or the answer
 * to a question. Goes into the Jira description when the bug is filed.
 */
export async function addToBashItem(itemId: string, text: string) {
  return attempt(async () => {
    const parent = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true, areaId: true, kind: true, mergedIntoId: true } });
    if (!parent || !["bug", "question", "note", "idea"].includes(parent.kind)) throw new UserError("That find isn't here anymore.");
    const { bash, user } = await requireIn(parent.bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up.");
    const add = await db.bashItem.create({ data: { bashId: parent.bashId, areaId: parent.areaId, kind: "add", replyToId: parent.mergedIntoId ?? itemId, text: addSchema.parse(text), byId: user.id, byName: nameOf(user) } });
    refresh(bash.project.key);
    return { id: add.id };
  });
}

/** Edit your own find's line or details while the bash is on. */
export async function editBashItem(itemId: string, input: { text: string; details?: string }) {
  return attempt(async () => {
    const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true, byId: true, defectId: true } });
    if (!item) throw new UserError("That find isn't here anymore.");
    const { bash, user } = await requireIn(item.bashId);
    if (item.byId !== user.id) throw new UserError("Only whoever logged it can change it.");
    if (item.defectId) throw new UserError("It's already filed, so change it in Jira.");
    const data = z.object({ text: z.string().trim().min(1, "Say what you found, in one line.").max(300), details: z.string().trim().max(5000).optional() }).parse(input);
    await db.bashItem.update({ where: { id: itemId }, data });
    refresh(bash.project.key);
    return {};
  });
}

/**
 * What you're testing → Edit: the starter (or a lead) changes an area's links, or
 * the whole bash's (areaId null). Everyone sees the change on their next refresh.
 */
export async function setBashLinks(bashId: string, areaId: string | null, links: BashLink[]) {
  return attempt(async () => {
    const { bash } = await requireOwner(bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up.");
    const list = z.array(linkSchema).max(10, "Up to 10 links.").parse(links);
    if (areaId === null) await db.bugBash.update({ where: { id: bashId }, data: { links: list as Prisma.InputJsonValue } });
    else {
      const areas = parseAreas(bash.areas);
      if (!areas.some((a) => a.id === areaId)) throw new UserError("That area isn't in this bash.");
      await db.bugBash.update({ where: { id: bashId }, data: { areas: areas.map((a) => (a.id === areaId ? { ...a, links: list } : a)) as Prisma.InputJsonValue } });
    }
    refresh(bash.project.key);
    return {};
  });
}

/**
 * + Add area (ver_169): whoever started the bash (or a lead) adds an area while it's
 * scheduled or on. It gets its charter and a place in the bash's run, like Start makes,
 * and a "New" tag for 10 minutes. Slack hears about it if the bash already posted there.
 */
export async function addBashArea(bashId: string, rawName: string) {
  return attempt(async () => {
    const { bash, user } = await requireOwner(bashId);
    const phase = phaseOf(bash);
    if (phase === "ended" || phase === "wrapped") throw new UserError("This bash is over, so its areas can't change.");
    const name = areaNameSchema.parse(rawName);
    const areas = parseAreas(bash.areas);
    if (areas.some((a) => a.name.trim().toLowerCase() === name.toLowerCase())) throw new UserError(`There's already an area called ${name}.`);
    if (areas.length >= 12) throw new UserError("A bash can have up to 12 areas.");
    const by = nameOf(user);
    const home = { id: bash.projectId };
    const library = bash.run.projectId === home.id ? [home.id] : [bash.run.projectId, home.id];
    const id = `a${Math.max(0, ...areas.map((a) => Number(/^a(\d+)$/.exec(a.id)?.[1] ?? 0))) + 1}`;
    const addedAt = new Date().toISOString();
    await db.$transaction(
      async (tx) => {
        const folder = await bashFolder(tx, home.id);
        const caseId = await areaCharter(tx, { homeId: home.id, folderId: folder.id, name, tpl: null, minutes: bash.minutes, bashName: bash.name, user, by });
        // The run gets the new charter unless it's already there (the same area added back).
        if (!(await tx.runEntry.findFirst({ where: { runId: bash.run.id, caseId }, select: { id: true } }))) {
          const last = await tx.runEntry.findFirst({ where: { runId: bash.run.id }, orderBy: { position: "desc" }, select: { position: true } });
          const [entry] = await buildEntries(tx, library, [caseId], null);
          if (entry) {
            const { assigneeId, ...e } = entry;
            void assigneeId;
            await tx.runEntry.create({ data: { ...e, position: (last?.position ?? -1) + 1, runId: bash.run.id } });
          }
        }
        // Re-read inside the transaction so two quick adds don't overwrite each other.
        const fresh = parseAreas((await tx.bugBash.findUniqueOrThrow({ where: { id: bashId }, select: { areas: true } })).areas);
        if (fresh.some((a) => a.name.trim().toLowerCase() === name.toLowerCase())) throw new UserError(`There's already an area called ${name}.`);
        const nextId = fresh.some((a) => a.id === id) ? `a${Math.max(0, ...fresh.map((a) => Number(/^a(\d+)$/.exec(a.id)?.[1] ?? 0))) + 1}` : id;
        await tx.bugBash.update({ where: { id: bashId }, data: { areas: [...fresh, { id: nextId, name, caseId, template: null, links: [], addedAt }] as Prisma.InputJsonValue } });
      },
      { timeout: 60_000 },
    );
    // Only once the start went out: a scheduled bash's start post lists every area anyway.
    if (bash.slack && bash.slackStartAt && phase === "live") {
      after(() =>
        postBash(bash.run.projectId, (base) => ({
          tone: "blue",
          title: `➕ Bug bash · ${esc(bash.name)} has a new area`,
          lines: [`New area: ${esc(name)}. Added by ${esc(by)}.`],
          button: { label: "Join the bash", url: `${base}/p/${bash.project.key}/bashes/${bash.id}?join=1` },
        })).catch(() => {}),
      );
    }
    refresh(bash.project.key, bash.run.project.key);
    return { name };
  });
}

/**
 * What's being tested → Edit (ver_172): the starter (or a lead) changes the build or
 * environment, say when a new build drops. It's the run's, so the run shows it too.
 * Finds already logged keep the build they were logged on.
 */
export async function setBashSetup(bashId: string, input: z.input<typeof setupSchema>) {
  return attempt(async () => {
    const { bash } = await requireOwner(bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up.");
    const data = setupSchema.parse(input);
    await db.testRun.update({ where: { id: bash.run.id }, data: { build: data.build, environment: data.environment } });
    refresh(bash.project.key, bash.run.project.key);
    return {};
  });
}

/**
 * + Add a link: a pasted web address as it is, else Jira issues (like + Link requirement)
 * and open or recently merged PRs in the umbrella's connected GitHub repos.
 */
export async function searchBashLinks(bashId: string, q: string) {
  return attempt(async () => {
    const { bash } = await requireIn(bashId);
    const text = z.string().trim().max(300).parse(q);
    if (/^https?:\/\//i.test(text)) {
      const l = webLink(text);
      return { links: l ? [l] : [], note: "" };
    }
    const found: BashLink[] = [];
    const notes: string[] = [];
    const setup = await storiesConfigFor(bash.projectId).catch(() => null);
    if (setup && text) {
      try {
        const issues = await (await jiraFor(bash.projectId))!.searchStories(setup.config, text);
        for (const i of issues.slice(0, 6)) found.push({ kind: "jira", key: i.key, title: i.summary, url: i.url ?? "", state: i.status });
      } catch {
        notes.push("Couldn't search Jira.");
      }
    }
    const groupId = bash.project.groupId ?? (await db.projectGroup.findFirst({ where: { hubProjectId: bash.projectId }, select: { id: true } }))?.id;
    const repos = groupId ? await db.gitHubRepo.findMany({ where: { groupId }, select: { fullName: true, tokenEncrypted: true } }) : [];
    const words = text.toLowerCase().replace(/^#/, "");
    for (const r of repos) {
      try {
        const pulls = await new GitHubClient(r.fullName, open(r.tokenEncrypted)).pulls();
        for (const p of pulls.filter((p) => p.state !== "closed" && (!words || String(p.number) === words || p.title.toLowerCase().includes(words))).slice(0, 6))
          found.push({ kind: "pr", key: `#${p.number}`, title: `${p.title}${repos.length > 1 ? ` (${r.fullName})` : ""}`, url: p.url, state: `${p.state === "merged" ? "Merged" : "Open"}${p.author ? ` · ${p.author}` : ""}` });
      } catch {
        notes.push(`Couldn't read pull requests in ${r.fullName}. The token may need "Pull requests: Read-only".`);
      }
    }
    return { links: found, note: notes.join(" ") };
  });
}

/** A prompt in this person's area ticked or unticked. */
export async function coverBashPrompt(bashId: string, prompt: string, on: boolean) {
  return attempt(async () => {
    const { bash, user } = await requireIn(bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up, so its checklist is closed.");
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

const reviewSchema = z.object({
  review: z.enum(["file", "skip"]).optional(),
  /** Not a bug's reason (ver_220): Works as designed, Can't reproduce, Duplicate or one typed. */
  reason: z.string().trim().max(120).optional(),
  severity: z.enum(["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR"]).optional(),
  platform: z.string().max(200).optional(),
});

/** Wrap-up list: File it / Not a bug (with a reason), severity, and the client (platform) it was found on; "" clears it. */
export async function reviewBashItem(itemId: string, input: z.input<typeof reviewSchema>) {
  return attempt(async () => {
    const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true } });
    if (!item) throw new UserError("That bug isn't here anymore.");
    const { bash } = await requireOwner(item.bashId);
    const data = reviewSchema.parse(input);
    await db.bashItem.update({ where: { id: itemId }, data: { ...(data.review && { review: data.review }), ...(data.review === "file" ? { reviewReason: "" } : data.reason !== undefined && { reviewReason: data.reason }), ...(data.severity && { severity: data.severity }), ...(data.platform !== undefined && { platform: cleanPlatform(data.platform) }) } });
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
      if (r.byId && r.byId !== keep.byId) people.set(r.byId, { id: r.byId, name: r.byName, platform: r.platform });
      for (const p of plusOnesOf(r.plusOnes)) if (p.id !== keep.byId) people.set(p.id, p);
    }
    await db.$transaction([
      db.bashItem.update({ where: { id: keep.id }, data: { plusOnes: [...people.values()] as Prisma.InputJsonValue, details: [keep.details, ...rest.map((r) => `Also logged by ${r.byName}: ${r.text}${r.details ? `\n${r.details}` : ""}`)].filter(Boolean).join("\n\n").slice(0, 5000) } }),
      db.bashItem.updateMany({ where: { id: { in: rest.map((r) => r.id) } }, data: { mergedIntoId: keep.id, review: "skip" } }),
      db.attachment.updateMany({ where: { bashItemId: { in: rest.map((r) => r.id) } }, data: { bashItemId: keep.id } }),
      db.bashItem.updateMany({ where: { replyToId: { in: rest.map((r) => r.id) } }, data: { replyToId: keep.id } }),
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

/** The options Jira lists for Client/SKUs, or none when Jira can't say. */
async function jiraClientOptions(projectId: string): Promise<string[]> {
  const client = await jiraFor(projectId);
  const meta = client ? await client.fieldMeta().catch(() => null) : null;
  return meta?.find((f) => f.name.trim().toLowerCase() === FIELD.clients.toLowerCase())?.options ?? [];
}

/** File one logged bug: to Jira when connected, else as a bug here. Returns the key. */
async function fileItem(bash: Awaited<ReturnType<typeof loadBash>>, itemId: string): Promise<string> {
  const raw = await db.bashItem.findUniqueOrThrow({ where: { id: itemId }, include: { attachments: { select: { id: true } } } });
  const item = withOko(raw, await bashOkoFor(bash.run.projectId));
  if (item.defectId) return "";
  const areas = parseAreas(bash.areas);
  const area = areas.find((a) => a.id === item.areaId);
  const entry = await db.runEntry.findFirst({ where: { runId: bash.run.id, caseId: area?.caseId ?? "" }, select: { id: true } });
  if (!entry) throw new UserError("That area's charter isn't in the run anymore.");
  const seen = plusOnesOf(item.plusOnes);
  // Where it was seen (ver_146): "by Ana on Unity. Also seen by Raj on Web". No platform, no change.
  const foundIn = `${bash.name}, area ${area?.name ?? ""}, by ${item.byName}${onPlatform(item.platform)}${seen.length ? `. Also seen by ${seen.map((p) => `${p.name}${onPlatform(p.platform)}`).join(", ")}` : ""}`;
  // Plain bugs get the platform as a [bracket] tag in front, like a run's bug; templates follow their own title setting.
  const tagged = (title: string) => (item.platform ? `[${item.platform}] ${title}` : title);
  // Additions and what was being tested: PRs and pages in the description, Jira issues as "relates to".
  const adds = await db.bashItem.findMany({ where: { replyToId: item.id, kind: "add" }, orderBy: { createdAt: "asc" }, select: { byName: true, text: true } });
  const links = [...(area?.links ?? []), ...parseLinks(bash.links)];
  const actual = [
    item.details || item.text,
    adds.length ? `Added during the bash:\n${adds.map((a) => `- ${a.byName}: ${a.text}`).join("\n")}` : "",
    links.some((l) => l.kind !== "jira") ? `What was being tested:\n${links.filter((l) => l.kind !== "jira").map((l) => `- ${l.key}${l.title ? ` ${l.title}` : ""}: ${l.url}`).join("\n")}` : "",
    `Found in the bug bash ${foundIn}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const stories = [...new Set(links.filter((l) => l.kind === "jira").map((l) => l.key))].slice(0, 10);
  let defectId: string, key: string;
  const t = itemTemplate(item);
  if (t) {
    // With its bug template: held back until it has what the template must have.
    const needs = needsOf(t.layout, t.answers, await db.attachment.findMany({ where: { bashItemId: item.id }, select: { fileName: true, contentType: true } }), item.platform).words;
    if (needs.length) throw new UserError(needsLine(needs));
    // A plain bug filed with the OKO layout keeps it, so the filing reads it back.
    if (!raw.templateName) await db.bashItem.update({ where: { id: item.id }, data: { templateName: t.name, layout: t.layout as unknown as Prisma.InputJsonValue, answers: t.answers as unknown as Prisma.InputJsonValue } });
    const inSections = new Set(t.answers.flatMap((a) => (a.files ?? []).map((f) => f.id)));
    const notes = [
      adds.length ? { name: "Added during the bash", text: adds.map((a) => `- ${a.byName}: ${a.text}`).join("\n") } : null,
      links.some((l) => l.kind !== "jira") ? { name: "What was being tested", text: links.filter((l) => l.kind !== "jira").map((l) => `- ${l.key}${l.title ? ` ${l.title}` : ""}: ${l.url}`).join("\n") } : null,
      { name: "Found in", text: `The bug bash ${foundIn}.` },
    ].filter((n): n is { name: string; text: string } => !!n);
    // The OKO layout (ver_220): Jira's own fields, as the OKO form files them. Client/SKUs follows
    // the bug's client when nobody picked one; the bash notes go under Description.
    let answers = t.answers;
    let fields: Record<string, string[]> = {};
    if (t.layout.oko) {
      const clientOptions = item.platform && !t.layout.fields.some((f) => f.name === FIELD.clients && f.value.length) ? await jiraClientOptions(bash.run.projectId) : [];
      fields = Object.fromEntries(t.layout.fields.map((f) => [f.id, f.name === FIELD.clients && !f.value.length && item.platform ? [optionLike(clientOptions, item.platform) || item.platform] : f.value]));
      answers = t.answers.map((a) => (a.heading.trim().toLowerCase() === "description" ? { ...a, text: [a.text, ...notes.map((n) => `${n.name}: ${n.text}`)].filter(Boolean).join("\n\n") } : a));
    }
    const r = await fileTemplatedBug(bash.run.projectId, entry.id, {
      templateId: item.templateId ?? "bash",
      bashItemId: item.id,
      summary: item.text.slice(0, 200),
      platform: item.platform,
      area: area?.name ?? "",
      build: item.build || bash.run.build,
      severity: item.severity,
      stepIndex: null,
      actual: item.details || item.text,
      answers,
      fields,
      attachmentIds: item.attachments.map((a) => a.id).filter((id) => !inSections.has(id)),
      stories,
      notes,
      // Picked at Fill in; otherwise the release picked for you, as before.
      ...(item.foundIn !== null && item.foundIn !== undefined && { foundIn: item.foundIn }),
    });
    if (!r.ok) throw new UserError(r.error);
    defectId = r.defect.id;
    key = r.defect.externalKey ?? `D-${r.defect.number}`;
  } else if (await jiraConfigFor(bash.run.projectId)) {
    // The build it was logged on, even if the bash moved to a newer one since (ver_172).
    const runAs = item.build || item.environment ? { build: item.build, environment: item.environment } : undefined;
    const r = await fileJiraBug(bash.run.projectId, entry.id, { summary: tagged(item.text).slice(0, 250), severity: item.severity, stepIndex: null, actual, attachmentIds: item.attachments.map((a) => a.id), stories, runAs });
    if (!r.ok) throw new UserError(r.error);
    defectId = r.defect.id;
    key = r.defect.externalKey ?? `D-${r.defect.number}`;
  } else {
    const setup = [item.build && `Build: ${item.build}`, item.environment && `Environment: ${item.environment}`].filter(Boolean).join("\n");
    const r = await createLocalDefect(bash.run.projectId, { title: tagged(item.text), severity: item.severity, entryId: entry?.id, foundIn: bash.release, description: [setup, actual].filter(Boolean).join("\n\n") });
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
 * If any bug won't file, nothing wraps: the review screen shows why, and
 * Wrap up anyway (`anyway`) closes it without trying those bugs again.
 */
export async function wrapUpBash(bashId: string, anyway = false) {
  return attempt(async () => {
    const { bash, user } = await requireOwner(bashId);
    if (bash.wrappedAt) throw new UserError("It's already wrapped up.");
    if (phaseOf(bash) === "live" || phaseOf(bash) === "scheduled") await db.bugBash.update({ where: { id: bashId }, data: { endedAt: new Date() } });
    const areas = parseAreas(bash.areas);
    const all = await db.bashItem.findMany({ where: { bashId }, orderBy: { createdAt: "asc" }, include: { attachments: { select: { id: true, fileName: true, contentType: true, size: true } } } });
    // Additions ride along in the line they add to, so sessions stay one line per find.
    const addsTo = new Map<string, string[]>();
    for (const a of all) if (a.kind === "add" && a.replyToId) addsTo.set(a.replyToId, [...(addsTo.get(a.replyToId) ?? []), `${a.byName}: ${a.text}`]);
    const items = all.filter((i) => i.kind !== "add").map((i) => (addsTo.has(i.id) ? { ...i, details: [i.details, `Added: ${addsTo.get(i.id)!.join("; ")}`].filter(Boolean).join("\n") } : i));
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
        // A bug that still needs something stays unfiled and doesn't stop the wrap-up (ver_220):
        // the button said so, and it can be filed later from the report.
        if (!isNeedsLine(why)) errors.push(`${it.text}: ${why}`);
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
              status: "EXPLORED",
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
          await tx.runEntry.update({ where: { id: entry.id }, data: { status: "EXPLORED", lastTestedAt: now } });
        }
        // Areas nobody explored stay Untested; the run closes either way.
        await tx.testRun.update({ where: { id: bash.run.id }, data: { state: "COMPLETED", completedAt: now } });
        await tx.bugBash.update({ where: { id: bashId }, data: { wrappedAt: now } });
      },
      { timeout: 60_000 },
    );
    await logActivity({ actor: user, kind: "run", action: `Wrapped up the bug bash ${bash.name}`, project: bash.run.project, detail: `${filedCount} bugs filed` });
    // The summary: to Slack channels with Bug bash ended on, and the email digest. Only once.
    const claimed = await db.bugBash.updateMany({ where: { id: bashId, slackDoneAt: null }, data: { slackDoneAt: new Date() } });
    if (claimed.count) await bashEnded(bashId, bash.run.projectId, bash.slack, () => bashSummaryLine(bashId)).catch((e) => console.warn("Bug bash summary failed", e));
    refresh(bash.project.key, bash.run.project.key);
    return { filed: filedCount, errors, wrapped: true };
  });
}

/**
 * File this bug…: a bash bug filed later from the usual bug box, at wrap-up or
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

const okoText = (n: number) => z.string().max(n).default("");
/** The OKO form's bug, as Fill in at wrap-up sends it (ver_220). */
const okoBugSchema = z.object({
  clientTag: okoText(40),
  feature: okoText(120),
  brief: okoText(300),
  observedOn: okoText(1000),
  clientsNeeded: okoText(200),
  what: okoText(20000),
  slack: okoText(2000),
  history: z.object({ dateTime: okoText(200), client: okoText(500), csp: okoText(200), context: okoText(500), user: okoText(500), envTenant: okoText(500), repros: okoText(100) }),
  reproSteps: okoText(20000),
  spaceLink: okoText(1000),
  impact: okoText(10000),
  workaround: okoText(10000),
  reproRate: okoText(100),
  build: okoText(500),
  clients: z.array(z.string().max(100)).max(30).default([]),
  team: okoText(100),
  olyEnv: z.array(z.string().max(100)).max(30).default([]),
});

/** The options Jira lists for the OKO form's pickers (Team, Client/SKUs, Oly Environment), for Fill in at wrap-up. */
export async function bashOkoOptions(bashId: string, itemId?: string) {
  return attempt(async () => {
    const { bash } = await requireIn(bashId);
    const client = await jiraFor(bash.run.projectId);
    const meta = client ? await client.fieldMeta().catch(() => null) : null;
    const of = (name: string) => meta?.find((f) => f.name.trim().toLowerCase() === name.toLowerCase())?.options ?? [];
    // The rest of a run's Report a bug (Nov 12 2026, same form everywhere): Jira Priority,
    // Jira's file size limit and the Found in line, each only when Jira has it.
    const [priority, fileLimit, foundIn] = client
      ? await Promise.all([client.priorityName(meta).catch(() => null), client.uploadLimit().catch(() => null), itemId ? bashFoundIn(bash, itemId) : null])
      : [null, null, null];
    return { options: { clients: of(FIELD.clients), team: of(FIELD.team), olyEnv: of(FIELD.olyEnv) }, priority, fileLimit, foundIn };
  });
}

/** The Found in line for a bash bug: what filing would pick, and what was picked at Fill in. */
async function bashFoundIn(bash: Awaited<ReturnType<typeof requireIn>>["bash"], itemId: string) {
  const item = await db.bashItem.findFirst({ where: { id: itemId, bashId: bash.id }, select: { areaId: true, foundIn: true } });
  const area = item ? parseAreas(bash.areas).find((a) => a.id === item.areaId) : null;
  const entry = area ? await db.runEntry.findFirst({ where: { runId: bash.run.id, caseId: area.caseId ?? "" }, select: { id: true } }) : null;
  if (!item || !entry) return null;
  const r = await previewFoundIn(bash.run.projectId, entry.id);
  if (!r.ok || !r.foundIn) return null;
  return { draft: r.foundIn, picked: item.foundIn };
}

/**
 * Fill in with the OKO form (ver_220): the same form as a run's Report a bug, for a bash bug in
 * an OKO cycle. What's typed goes back under the OKO layout's headings and Jira fields.
 */
export async function fillBashOko(itemId: string, input: { bug: TemplateBug; severity?: string; attachmentIds?: string[]; foundIn?: string | null }) {
  return attempt(async () => {
    const raw = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true, areaId: true, kind: true, text: true, details: true, build: true, platform: true, severity: true, defectId: true, templateName: true, layout: true, answers: true, bash: { select: { run: { select: { projectId: true } } } } } });
    const oko = raw?.bash.run ? await bashOkoFor(raw.bash.run.projectId) : null;
    const t = raw ? itemTemplate(withOko(raw, oko)) : null;
    if (!raw || !t?.layout.oko) throw new UserError("That bug isn't here anymore.");
    const { bash, user } = await requireIn(raw.bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up.");
    if (raw.defectId) throw new UserError("It's already filed, so change it there.");
    const bug = okoBugSchema.parse(input.bug);
    const severity = z.enum(["SHOWSTOPPER", "CRITICAL", "PROBLEMATIC", "MINOR"]).optional().parse(input.severity);
    const area = parseAreas(bash.areas).find((a) => a.id === raw.areaId)?.name ?? "";
    const next = okoIntoDraft({ platform: raw.platform, area, summary: raw.text, answers: t.answers, fields: t.layout.fields }, bug);
    const layout = { ...t.layout, fields: t.layout.fields.map((f) => ({ ...f, value: next.fields.find((x) => x.id === f.id)?.value ?? f.value })) };
    await db.bashItem.update({
      where: { id: itemId },
      data: {
        templateName: t.name,
        layout: layout as unknown as Prisma.InputJsonValue,
        answers: next.answers as unknown as Prisma.InputJsonValue,
        text: next.summary.trim().slice(0, 300) || raw.text,
        platform: cleanPlatform(next.platform),
        ...(severity && { severity }),
        ...(input.foundIn !== undefined && { foundIn: z.string().trim().max(255).nullable().parse(input.foundIn) }),
      },
    });
    const ids = z.array(z.string().max(40)).max(10).parse(input.attachmentIds ?? []);
    if (ids.length) await db.attachment.updateMany({ where: { id: { in: ids }, projectId: bash.run.projectId, uploadedById: user.id, resultId: null, defectId: null }, data: { bashItemId: itemId } });
    const needs = await itemNeeds(itemId, oko);
    if (!needs.length) await db.bashItem.updateMany({ where: { id: itemId, fileError: { startsWith: "Needs " } }, data: { fileError: "" } });
    refresh(bash.project.key);
    return { needs };
  });
}

/**
 * Not a bug › Can't reproduce (ver_220, Scott): a note that @mentions the finder, like
 * "@Sam, we couldn't reproduce this. Can you add steps?". It shows on the find, on the finder's
 * screen with a box to answer, and goes to them by email when email is set up.
 */
export async function askBashFinder(itemId: string, note: string) {
  return attempt(async () => {
    const item = await db.bashItem.findUnique({ where: { id: itemId }, select: { id: true, bashId: true, areaId: true, kind: true, text: true, byId: true, byName: true } });
    if (!item || item.kind !== "bug") throw new UserError("That bug isn't here anymore.");
    const { bash, user } = await requireOwner(item.bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up.");
    const text = addSchema.parse(note);
    await db.bashItem.create({ data: { bashId: item.bashId, areaId: item.areaId, kind: "add", replyToId: item.id, text, byId: user.id, byName: nameOf(user) } });
    await db.bashItem.update({ where: { id: item.id }, data: { review: "skip", reviewReason: CANT_REPRODUCE } });
    let emailed = false;
    const finder = item.byId && item.byId !== user.id ? await db.user.findUnique({ where: { id: item.byId }, select: { email: true } }) : null;
    if (finder?.email && (await mailOn())) {
      try {
        await sendMail({
          to: finder.email,
          subject: `Can you add steps? · ${bash.name}`,
          lines: [`${nameOf(user)} is wrapping up the bug bash ${bash.name} and couldn't reproduce your bug "${item.text}".`, text],
          button: { label: "Add steps", url: `${await origin()}/p/${bash.project.key}/bashes/${bash.id}` },
        });
        emailed = true;
      } catch (e) {
        console.warn("Bug bash ask email failed", e);
      }
    }
    refresh(bash.project.key);
    return { emailed };
  });
}

/**
 * The finder answers Can't reproduce: their steps go on the find and, for a bug with the OKO
 * layout or a template with Repro steps, under that heading too. Whoever wraps up sees it.
 */
export async function answerBashAsk(itemId: string, steps: string) {
  return attempt(async () => {
    const raw = await db.bashItem.findUnique({ where: { id: itemId }, select: { bashId: true, areaId: true, kind: true, text: true, details: true, build: true, defectId: true, templateName: true, layout: true, answers: true, bash: { select: { run: { select: { projectId: true } } } } } });
    if (!raw || raw.kind !== "bug") throw new UserError("That bug isn't here anymore.");
    const { bash, user } = await requireIn(raw.bashId);
    if (phaseOf(bash) === "wrapped") throw new UserError("This bash is wrapped up.");
    const text = addSchema.parse(steps);
    await db.bashItem.create({ data: { bashId: raw.bashId, areaId: raw.areaId, kind: "add", replyToId: itemId, text, byId: user.id, byName: nameOf(user) } });
    const t = itemTemplate(withOko(raw, raw.bash.run ? await bashOkoFor(raw.bash.run.projectId) : null));
    const repro = t?.answers.find((a) => /^(repro steps|steps to see it|steps)$/i.test(a.heading.trim()));
    if (t && repro && !raw.defectId) {
      const answers = t.answers.map((a) => (a.id === repro.id ? { ...a, text: [a.text.trim(), text].filter(Boolean).join("\n") } : a));
      await db.bashItem.update({ where: { id: itemId }, data: { answers: answers as unknown as Prisma.InputJsonValue, ...(!raw.templateName && { templateName: t.name, layout: t.layout as unknown as Prisma.InputJsonValue }) } });
    }
    refresh(bash.project.key);
    return {};
  });
}
