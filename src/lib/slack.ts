import "server-only";
import type { ResultStatus, Severity, SlackChannel } from "@prisma/client";
import { headers } from "next/headers";
import { after } from "next/server";
import { open } from "./crypto";
import { db } from "./db";
import { caseKey } from "./format";
import { releaseKey } from "./rc-status";
import { severityScaleFor } from "./severity-server";
import { bashDigest, emailBashDigest, emailRcDigest, emailRunDigest, later, runDigest } from "./digests";
import { bashSlackLines, runSlackLines, type RunDigest } from "./digest-render";
import { atLeast, parseAlerts, type AlertId, type Alerts } from "./slack-alerts";
import { OPEN } from "./status";

// Slack alerts: Flaw Patrol only sends messages out, through each channel's
// incoming webhook, so it works without hosting. Sending never holds up a save.

export type SlackMessage = { tone: "red" | "green" | "amber" | "blue"; title: string; lines: string[]; button?: { label: string; url: string } | null; more?: { label: string; url: string }[] };
type Channel = { id: string; name: string; webhook: string; alerts: Alerts };

const COLOR = { red: "#D93F3F", green: "#2EA44F", amber: "#E3A008", blue: "#3B82F6" };

/** Slack's mrkdwn needs &, < and > escaped in anything people typed. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function payload(m: SlackMessage) {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: [`*${m.title}*`, ...m.lines].join("\n") } }];
  const buttons = [...(m.button ? [m.button] : []), ...(m.more ?? [])];
  if (buttons.length) blocks.push({ type: "actions", elements: buttons.map((b) => ({ type: "button", text: { type: "plain_text", text: b.label }, url: b.url })) });
  return { text: m.title, attachments: [{ color: COLOR[m.tone], blocks }] };
}

/** Post one message. Throws a plain-English error when Slack refuses it. */
export async function postToSlack(webhook: string, m: SlackMessage) {
  let res: Response;
  try {
    res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(m)), signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("Couldn't reach Slack. Check the computer's internet connection.");
  }
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  if (res.status === 404 || /no_service|invalid_token/.test(text)) throw new Error("Slack doesn't know this webhook link. It may have been removed in Slack; make a new one.");
  if (/channel_is_archived/.test(text)) throw new Error("That Slack channel is archived.");
  throw new Error(`Slack refused the message (${res.status}${text ? `: ${text.slice(0, 80)}` : ""}).`);
}

/** The channel rows a test cycle posts to: its umbrella's (all, or the ticked ones plus its own), or its own. Paused ones left out. */
async function channelRows(projectId: string): Promise<SlackChannel[]> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, groupId: true, slackMode: true, slackChannelIds: true, hubOf: { select: { id: true } } } });
  if (!project) return [];
  const groupId = project.hubOf?.id ?? project.groupId;
  const umbrella = groupId ? await db.projectGroup.findFirst({ where: { id: groupId, hubProjectId: { not: null } }, select: { id: true } }) : null;
  const where = !umbrella
    ? { projectId }
    : project.hubOf || project.slackMode === "umbrella"
      ? { groupId: umbrella.id }
      : project.slackMode === "off"
        ? null
        : { OR: [{ groupId: umbrella.id, id: { in: project.slackChannelIds } }, { projectId }] };
  return where ? db.slackChannel.findMany({ where: { ...where, paused: false }, orderBy: { createdAt: "asc" } }) : [];
}

/** The channels a test cycle posts to, with their webhook links opened. */
export async function channelsFor(projectId: string): Promise<Channel[]> {
  const out: Channel[] = [];
  for (const r of await channelRows(projectId)) {
    try {
      out.push({ id: r.id, name: r.name, webhook: open(r.webhookEncrypted), alerts: parseAlerts(r.alerts) });
    } catch {
      // Sealed with another AUTH_SECRET: the settings card says so; skip it here.
    }
  }
  return out;
}

/** For the run page's bell: where this test cycle posts, and what. No webhook links. */
export async function slackSummaryFor(projectId: string) {
  return (await channelRows(projectId)).map((r) => ({ name: r.name, alerts: parseAlerts(r.alerts) }));
}

/** Where links in messages point: AUTH_URL when set, else the Flaw Patrol the person was using. */
export async function origin() {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  try {
    const h = await headers();
    return h.get("origin") ?? (h.get("host") ? `http://${h.get("host")}` : "http://localhost:3000");
  } catch {
    return "http://localhost:3000";
  }
}

/** Whether a channel wants the longer post for this alert: "Counts and what failed" / "Counts and top finds". */
const wantsDetail = (a: Alerts, alert: AlertId) => (alert === "run" ? a.runDetail : alert === "bash" ? a.bashDetail : false);

/** Send an alert to every channel of the test cycle that has it on, after the response. `detail` asks for the longer post. */
export async function notify(projectId: string, alert: AlertId, build: (base: string, detail: boolean) => Promise<SlackMessage | null> | SlackMessage | null, severity?: Severity) {
  const base = await origin();
  const job = async () => {
    try {
      const channels = (await channelsFor(projectId)).filter((c) => c.alerts[alert] && (alert !== "bug" || (severity && atLeast(severity, c.alerts.sev))));
      if (!channels.length) return;
      // Each message is built once, whichever channels want it.
      const made = new Map<boolean, Promise<SlackMessage | null>>();
      const message = (detail: boolean) => {
        if (!made.has(detail)) made.set(detail, Promise.resolve(build(base, detail)));
        return made.get(detail)!;
      };
      await Promise.all(
        channels.map(async (c) => {
          const m = await message(wantsDetail(c.alerts, alert));
          if (m) await postToSlack(c.webhook, m).catch((e) => console.warn(`Slack alert to ${c.name} failed: ${e instanceof Error ? e.message : e}`));
        }),
      );
    } catch (e) {
      console.warn("Slack alert failed", e);
    }
  };
  try {
    after(job);
  } catch {
    void job();
  }
}

/** "Release 3.2 · iOS": the test cycle, and its platform when the name doesn't say it. */
function where(p: { name: string; platform: string }) {
  return p.platform && !p.name.toLowerCase().includes(p.platform.toLowerCase()) ? `${p.name} · ${p.platform}` : p.name;
}

const FAILS: ResultStatus[] = ["FAILED"];
// Slack shows its date tag on each reader's own clock; the text after | is for old clients (ver_197).
const short = (d: Date) => `<!date^${Math.floor(d.getTime() / 1000)}^{date_short}|${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}>`;

type CycleRef = { id: string; key: string; name: string; platform: string; groupId: string | null };

/** The case's previous finished result on the same platform (or the same test cycle), before `before`. */
async function previousResult(caseId: string, cycle: CycleRef, before: Date, notResult?: string) {
  return db.testResult.findFirst({
    where: {
      caseId,
      ...(notResult && { id: { not: notResult } }),
      createdAt: { lt: before },
      status: { notIn: OPEN },
      run: cycle.platform && cycle.groupId ? { project: { groupId: cycle.groupId, platform: { equals: cycle.platform, mode: "insensitive" } } } : { projectId: cycle.id },
    },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true, run: { select: { project: { select: { name: true, platform: true } } } } },
  });
}

/** After a result is saved: Regression, Case blocked, Run finished and Release testing done, as they apply. */
export async function alertsForResult(opts: { cycle: CycleRef; resultId: string; status: ResultStatus; comment: string; tester: string; entryId: string; wasOpen: boolean; runDone: boolean }) {
  const { cycle, status } = opts;
  if (FAILS.includes(status)) {
    const now = new Date();
    const entry = await db.runEntry.findUnique({ where: { id: opts.entryId }, select: { caseId: true, title: true, steps: true, run: { select: { number: true, automated: true } }, testCase: { select: { number: true, project: { select: { key: true } } } } } });
    if (entry && !entry.run.automated) {
      const prev = await previousResult(entry.caseId, cycle, now, opts.resultId);
      if (prev?.status === "PASSED")
        await notify(cycle.id, "reg", async (base) => {
          const result = await db.testResult.findUnique({ where: { id: opts.resultId }, select: { stepResults: true, defects: { select: { defect: { select: { externalKey: true, externalUrl: true, number: true } } } } } });
          const steps = (Array.isArray(entry.steps) ? entry.steps : []) as { action?: string; expected?: string }[];
          const failedAt = ((result?.stepResults ?? []) as { status: ResultStatus }[]).findIndex((s) => FAILS.includes(s.status));
          const bugs = (result?.defects ?? []).map(({ defect: d }) => (d.externalUrl ? `<${d.externalUrl}|${esc(d.externalKey ?? `D-${d.number}`)}>` : esc(d.externalKey ?? `D-${d.number}`)));
          return {
            tone: "red",
            title: `🔴 Regression · ${where(cycle)}`,
            lines: [
              `*${esc(caseKey(entry.testCase.project.key, entry.testCase.number))} ${esc(entry.title)}*`,
              `Passed in ${esc(where(prev.run.project))} (${short(prev.createdAt)}) → *Failed* now${failedAt >= 0 ? ` · step ${failedAt + 1} of ${steps.length}${steps[failedAt]?.expected ? `: "${esc(steps[failedAt].expected!.slice(0, 80))}"` : ""}` : ""}`,
              `Tester: ${esc(opts.tester)}${bugs.length ? ` · Bug: ${bugs.join(", ")}` : ""}`,
            ],
            button: { label: "Open in Flaw Patrol", url: `${base}/p/${cycle.key}/runs/${entry.run.number}/execute?entry=${opts.entryId}` },
          };
        });
    }
  }
  if (status === "BLOCKED" && opts.wasOpen)
    await notify(cycle.id, "block", async (base) => {
      const entry = await db.runEntry.findUnique({ where: { id: opts.entryId }, select: { title: true, run: { select: { number: true, automated: true } }, testCase: { select: { number: true, project: { select: { key: true } } } } } });
      if (!entry || entry.run.automated) return null;
      return {
        tone: "amber",
        title: `⛔ Case blocked · ${where(cycle)}`,
        lines: [`*${esc(caseKey(entry.testCase.project.key, entry.testCase.number))} ${esc(entry.title)}* · ${esc(opts.tester)}${opts.comment.trim() ? `: "${esc(opts.comment.trim().slice(0, 200))}"` : ""}`],
        button: { label: "Open in Flaw Patrol", url: `${base}/p/${cycle.key}/runs/${entry.run.number}/execute?entry=${opts.entryId}` },
      };
    });
  if (opts.runDone && opts.wasOpen) {
    const entry = await db.runEntry.findUnique({ where: { id: opts.entryId }, select: { runId: true } });
    if (entry) await runFinished(cycle, entry.runId, false);
  }
}

/** Regressions in a run: failed cases whose previous result elsewhere on the platform passed. */
async function regressionCount(cycle: CycleRef, runId: string, startedAt: Date) {
  const failed = await db.runEntry.findMany({ where: { runId, status: { in: FAILS } }, select: { caseId: true } });
  let n = 0;
  for (const f of failed.slice(0, 300)) if ((await previousResult(f.caseId, cycle, startedAt))?.status === "PASSED") n++;
  return n;
}

/** Run finished (every case has a result, or the run was closed), then Release testing done when it was the last. */
export async function runFinished(cycle: CycleRef, runId: string, closedEarly: boolean) {
  const run = await db.testRun.findUnique({ where: { id: runId }, select: { id: true, number: true, name: true, build: true, release: true, automated: true, createdAt: true, entries: { select: { status: true } } } });
  if (!run || run.automated) return;
  const base = await origin();
  // The longer post and the email digest share one look at the run.
  let digest: Promise<RunDigest | null> | null = null;
  const details = () => (digest ??= runDigest(cycle, runId, base));
  await notify(cycle.id, "run", async (base, detail) => {
    if (detail) {
      const d = await details();
      if (d)
        return {
          tone: d.failed || d.blocked ? "amber" : "green",
          title: `✅ Run finished · ${where(cycle)}`,
          lines: runSlackLines(d),
          button: { label: "Open run", url: d.runUrl },
          more: d.firstFailUrl ? [{ label: "See what failed", url: d.firstFailUrl }] : [],
        };
    }
    const total = run.entries.length;
    const count = (s: ResultStatus[]) => run.entries.filter((e) => s.includes(e.status)).length;
    const done = total - count(OPEN);
    const passed = count(["PASSED"]);
    const bugs = await db.defectLink.findMany({ where: { result: { runId } }, select: { defect: { select: { id: true, severity: true } } } });
    const unique = [...new Map(bugs.map((b) => [b.defect.id, b.defect])).values()];
    const serious = unique.filter((d) => atLeast(d.severity, "CRITICAL")).length;
    const regressions = await regressionCount(cycle, runId, run.createdAt);
    return {
      tone: count(FAILS) || count(["BLOCKED"]) ? "amber" : "green",
      title: `✅ Run finished · ${where(cycle)}`,
      lines: [
        `*${esc(run.name)}*${run.build ? ` · build ${esc(run.build)}` : ""}${closedEarly && done < total ? ` · closed with ${total - done} not run` : ""}`,
        `${done} run · ${passed} passed · ${count(FAILS)} failed · ${count(["BLOCKED"])} blocked${done ? ` · ${Math.round((passed / done) * 100)}% pass` : ""}`,
        `${regressions} ${regressions === 1 ? "regression" : "regressions"} · ${unique.length} ${unique.length === 1 ? "bug" : "bugs"}${serious ? ` (${serious} B - Critical or worse)` : ""}`,
      ],
      button: { label: "Open run", url: `${base}/p/${cycle.key}/runs/${run.number}` },
    };
  });
  later(() => emailRunDigest(cycle, runId, base, details));
  if (run.release.trim()) await rcDone(cycle, run.release, base);
}

/**
 * Bug bash ended: the summary to every channel with the Bug bash ended alert on
 * (when the bash's own Post to Slack tick is on), and the email digest.
 */
export async function bashEnded(bashId: string, projectId: string, post: boolean, counts: () => Promise<string>) {
  const base = await origin();
  const bash = await db.bugBash.findUnique({ where: { id: bashId }, select: { name: true, project: { select: { key: true } } } });
  if (!bash) return;
  if (post)
    await notify(projectId, "bash", async (base, detail) => {
      const url = `${base}/p/${bash.project.key}/bashes/${bashId}/report`;
      const d = detail ? await bashDigest(bashId, base) : null;
      return d
        ? { tone: "green", title: `🐞 Bug bash · ${bash.name} is done`, lines: bashSlackLines(d), button: { label: "See the report", url } }
        : { tone: "green", title: `🐞 Bug bash · ${bash.name} is done.`, lines: [await counts()], button: { label: "See the report", url } };
    });
  later(() => emailBashDigest(bashId, base));
}

/** Release testing done: every run of this release in the umbrella (or this test cycle) is done or closed. */
async function rcDone(cycle: CycleRef, release: string, base: string) {
  const key = releaseKey(release);
  const runs = (
    await db.testRun.findMany({
      where: { automated: false, release: { not: "" }, project: cycle.groupId ? { groupId: cycle.groupId, archivedAt: null } : { id: cycle.id } },
      select: { id: true, release: true, state: true, project: { select: { name: true, platform: true } }, entries: { select: { status: true } } },
    })
  ).filter((r) => releaseKey(r.release) === key);
  const open = (r: (typeof runs)[number]) => r.entries.filter((e) => OPEN.includes(e.status)).length;
  if (!runs.length || runs.some((r) => r.state !== "COMPLETED" && open(r) > 0)) return;
  await notify(cycle.id, "rc", async (base) => {
    const cols = runs.map((r) => {
      const total = r.entries.length;
      const done = total - open(r);
      const passed = r.entries.filter((e) => e.status === "PASSED").length;
      const label = done === total ? `*DONE* ${done ? Math.round((passed / done) * 100) : 0}% pass` : `*CLOSED · ${total - done} NOT RUN*`;
      return `${esc(r.project.platform || r.project.name)} ${label}`;
    });
    return {
      tone: "green",
      title: `🏁 ${release.trim()} testing done`,
      lines: [cols.join(" · ")],
      button: { label: "Open release status", url: cycle.groupId ? `${base}/g/${cycle.groupId}/rc?release=${encodeURIComponent(release.trim())}` : `${base}/p/${cycle.key}/reports/rc?release=${encodeURIComponent(release.trim())}` },
    };
  });
  const url = cycle.groupId ? `${base}/g/${cycle.groupId}/rc?release=${encodeURIComponent(release.trim())}` : `${base}/p/${cycle.key}/reports/rc?release=${encodeURIComponent(release.trim())}`;
  const platforms = runs.map((r) => {
    const done = r.entries.length - open(r);
    return { name: r.project.platform || r.project.name, passPct: done ? Math.round((r.entries.filter((e) => e.status === "PASSED").length / done) * 100) : null, notRun: r.entries.length - done };
  });
  later(() => emailRcDigest(cycle, release.trim(), runs.map((r) => r.id), { release: release.trim(), platforms, url }, base));
}

/** Serious bug filed from a run, to Jira. */
export async function alertBugFiled(cycle: CycleRef, bug: { key: string; url: string | null; title: string; severity: Severity }, from: { tester: string; caseKey: string; step: number | null }) {
  const scale = await severityScaleFor(cycle.id);
  await notify(
    cycle.id,
    "bug",
    () => ({
      tone: "red",
      title: `🐞 ${scale.labels[bug.severity]} bug filed · ${where(cycle)}`,
      lines: [`${bug.url ? `<${bug.url}|${esc(bug.key)}>` : esc(bug.key)} ${esc(bug.title)}`, from.caseKey ? `Filed by ${esc(from.tester)} from ${esc(from.caseKey)}${from.step !== null ? ` step ${from.step + 1}` : ""}` : `Written by ${esc(from.tester)} on the Bugs page`],
      button: bug.url ? { label: "Open in Jira", url: bug.url } : null,
    }),
    bug.severity,
  );
}

/** Run started. */
export async function alertRunStarted(cycle: CycleRef, runId: string, by: string) {
  await notify(cycle.id, "start", async (base) => {
    const run = await db.testRun.findUnique({ where: { id: runId }, select: { number: true, name: true, build: true, automated: true, _count: { select: { entries: true } } } });
    if (!run || run.automated) return null;
    return {
      tone: "blue",
      title: `▶️ Run started · ${where(cycle)}`,
      lines: [`*${esc(run.name)}*${run.build ? ` · build ${esc(run.build)}` : ""} · ${run._count.entries} cases · started by ${esc(by)}`],
      button: { label: "Open run", url: `${base}/p/${cycle.key}/runs/${run.number}` },
    };
  });
}

/** Ask to join: someone opened a link to the team and asked to be added. */
export async function alertJoinRequest(teamId: string, who: { name: string; email: string; what: string }, membersPath: string) {
  await notify(teamId, "join", (base) => ({
    tone: "blue",
    title: who.what === "Member access" ? `🙋 ${who.name} asks for Member access` : `🙋 ${who.name} wants to join`,
    lines: [
      who.what === "Member access" ? `${esc(who.email)} · a Viewer now` : `${esc(who.email)}${who.what ? ` · opened ${esc(who.what)} link` : ""}`,
      who.what === "Member access" ? "An admin can change their role in Settings → Members." : "An admin can add them in Settings → Members.",
    ],
    button: { label: "Open Members", url: `${base}${membersPath}` },
  }));
}

/** For the card: channels without their webhook links. */
export async function slackChannelsOf(where: { groupId: string } | { projectId: string }) {
  return (await db.slackChannel.findMany({ where, orderBy: { createdAt: "asc" } })).map(channelView);
}

/** Each test cycle's own channels, for several at once: one lookup instead of one per cycle. */
export async function slackChannelsByProject(projectIds: string[]) {
  const out = new Map<string, ReturnType<typeof channelView>[]>(projectIds.map((id) => [id, []]));
  if (!projectIds.length) return out;
  for (const r of await db.slackChannel.findMany({ where: { projectId: { in: projectIds } }, orderBy: { createdAt: "asc" } })) out.get(r.projectId!)?.push(channelView(r));
  return out;
}

function channelView(r: { id: string; name: string; webhookEncrypted: string; alerts: unknown; paused: boolean }) {
  let hook = "";
  try {
    hook = open(r.webhookEncrypted);
  } catch {
    hook = "";
  }
  // Only the end of the link shows, so a screenshot doesn't leak it.
  return { id: r.id, name: r.name, alerts: parseAlerts(r.alerts), paused: r.paused, readable: !!hook, hookEnd: hook ? `…${hook.slice(-6)}` : "" };
}

export type SlackChannelView = Awaited<ReturnType<typeof slackChannelsOf>>[number];

/**
 * Bug bash posts: the start, a 10-minute warning and the summary, to every
 * channel the test cycle posts to. The bash's own "Post to Slack" switch decides.
 */
export async function postBash(projectId: string, build: (base: string) => SlackMessage) {
  const base = await origin();
  const channels = await channelsFor(projectId);
  if (!channels.length) return 0;
  const m = build(base);
  await Promise.all(channels.map((c) => postToSlack(c.webhook, m).catch((e) => console.warn(`Slack bash post to ${c.name} failed: ${e instanceof Error ? e.message : e}`))));
  return channels.length;
}

/** Channel names a test cycle posts to, for "Posted to #qa in Slack". */
export async function channelNamesFor(projectId: string) {
  return (await channelRows(projectId)).map((r) => r.name);
}
