import "server-only";
import type { ResultStatus } from "@prisma/client";
import { after } from "next/server";
import { bashReport } from "./bash-summary";
import { db } from "./db";
import { DIGEST_DEFAULTS, memberGets, parseDigestSettings, parsePrefs, sends, type DigestKind, type DigestSettings } from "./digest-settings";
import { bashEmail, rcEmail, runEmail, tookText, type BashDigest, type Footer, type RcDigest, type RenderedMail, type RunDigest } from "./digest-render";
import { stopToken } from "./digest-token";
import { caseKey } from "./format";
import { mailSettings, mailReady, sendMail } from "./mail";
import { atLeast } from "./slack-alerts";
import { severityScaleFor } from "./severity-server";
import { OPEN } from "./status";

// Email digests: who gets a summary when a run finishes, a bug bash ends or a
// release's testing is done, the numbers that go in it, and sending it. Sending never holds
// up a save: it runs after the response, like Slack alerts.

type CycleRef = { id: string; key: string; name: string; platform: string; groupId: string | null };

/** "Release 3.2 · iOS": the test cycle, and its platform when the name doesn't say it. */
export function cycleWhere(p: { name: string; platform: string }) {
  return p.platform && !p.name.toLowerCase().includes(p.platform.toLowerCase()) ? `${p.name} · ${p.platform}` : p.name;
}

/** Runs on the same platform: in the umbrella when the test cycle has a platform, else the test cycle itself. */
const samePlatform = (c: CycleRef) => (c.platform && c.groupId ? { project: { groupId: c.groupId, platform: { equals: c.platform, mode: "insensitive" as const } } } : { projectId: c.id });

/** The case's previous finished result on the same platform, before `before`. */
async function previousStatus(caseId: string, cycle: CycleRef, before: Date) {
  const r = await db.testResult.findFirst({ where: { caseId, createdAt: { lt: before }, status: { notIn: OPEN }, run: samePlatform(cycle) }, orderBy: { createdAt: "desc" }, select: { status: true } });
  return r?.status ?? null;
}

const shortTime = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const shortDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
function span(from: Date, to: Date) {
  return shortDay(from) === shortDay(to) ? `${shortDay(from)}, ${shortTime(from)} to ${shortTime(to)}` : `${shortDay(from)}, ${shortTime(from)} to ${shortDay(to)}, ${shortTime(to)}`;
}

/** Everything a run digest says, for Slack's "Counts and what failed" and the email. */
export async function runDigest(cycle: CycleRef, runId: string, base: string): Promise<RunDigest | null> {
  const run = await db.testRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      number: true,
      name: true,
      kind: true,
      build: true,
      automated: true,
      createdAt: true,
      completedAt: true,
      entries: { orderBy: { position: "asc" }, select: { id: true, caseId: true, title: true, status: true, testCase: { select: { number: true, project: { select: { key: true } } } } } },
    },
  });
  if (!run) return null;
  const count = (s: ResultStatus[]) => run.entries.filter((e) => s.includes(e.status)).length;
  const total = run.entries.length;
  const done = total - count(OPEN);
  const passed = count(["PASSED"]);
  const results = await db.testResult.findMany({
    where: { runId },
    orderBy: { createdAt: "desc" },
    select: { entryId: true, testerName: true, comment: true, createdAt: true, defects: { select: { defect: { select: { id: true, number: true, title: true, severity: true, externalKey: true, externalUrl: true } } } } },
  });
  const latest = new Map<string, (typeof results)[number]>();
  for (const r of results) if (!latest.has(r.entryId)) latest.set(r.entryId, r);
  const key = (e: (typeof run.entries)[number]) => caseKey(e.testCase.project.key, e.testCase.number);
  const failedEntries = run.entries.filter((e) => e.status === "FAILED");
  const failures = [];
  for (const [i, e] of failedEntries.entries()) {
    const r = latest.get(e.id);
    const d = r?.defects[0]?.defect;
    // Regressions: passed last time on the same platform. Capped so a huge red run stays quick.
    const regression = i < 300 && (await previousStatus(e.caseId, cycle, run.createdAt)) === "PASSED";
    failures.push({ key: key(e), title: e.title, regression, tester: r?.testerName || "someone", bug: d ? { key: d.externalKey ?? `D-${d.number}`, url: d.externalUrl } : null });
  }
  const scale = await severityScaleFor(cycle.id);
  const bugMap = new Map<string, { key: string; url: string | null; title: string; severity: string; serious: boolean }>();
  for (const r of results)
    for (const { defect: d } of r.defects)
      if (!bugMap.has(d.id)) bugMap.set(d.id, { key: d.externalKey ?? `D-${d.number}`, url: d.externalUrl, title: d.title, severity: scale.labels[d.severity], serious: atLeast(d.severity, "CRITICAL") });
  const testers = [...new Set(results.map((r) => r.testerName).filter((n): n is string => !!n))].reverse();
  const end = run.completedAt ?? (results[0]?.createdAt && done === total ? results[0].createdAt : new Date());
  const passPct = done ? Math.round((passed / done) * 100) : null;
  // vs last run: the last finished run of the same kind on the same platform.
  const earlier = await db.testRun.findMany({
    where: { id: { not: run.id }, automated: false, kind: run.kind, createdAt: { lt: run.createdAt }, ...samePlatform(cycle) },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { state: true, entries: { select: { status: true } } },
  });
  const last = earlier.find((r) => r.state === "COMPLETED" || (r.entries.length > 0 && r.entries.every((e) => !OPEN.includes(e.status))));
  const lastDone = last ? last.entries.filter((e) => !OPEN.includes(e.status)).length : 0;
  const lastPct = last && lastDone ? Math.round((last.entries.filter((e) => e.status === "PASSED").length / lastDone) * 100) : null;
  return {
    where: cycleWhere(cycle),
    runName: run.name,
    build: run.build,
    took: tookText(end.getTime() - run.createdAt.getTime()),
    when: span(run.createdAt, end),
    closedNotRun: total - done,
    total,
    done,
    passed,
    failed: count(["FAILED"]),
    blocked: count(["BLOCKED"]),
    passPct,
    vsLast: passPct !== null && lastPct !== null ? passPct - lastPct : null,
    regressions: failures.filter((f) => f.regression).length,
    failures,
    blockedCases: run.entries.filter((e) => e.status === "BLOCKED").map((e) => ({ key: key(e), comment: latest.get(e.id)?.comment ?? "" })),
    bugs: [...bugMap.values()],
    testers,
    runUrl: `${base}/p/${cycle.key}/runs/${run.number}`,
    firstFailUrl: failedEntries[0] ? `${base}/p/${cycle.key}/runs/${run.number}/execute?entry=${failedEntries[0].id}` : null,
  };
}

/** Everything a bug bash digest says. */
export async function bashDigest(bashId: string, base: string): Promise<BashDigest | null> {
  const r = await bashReport(bashId);
  if (!r) return null;
  const minutes = r.bash.minutes;
  const finders = new Map<string, number>();
  for (const b of r.bugs) finders.set(b.byName, (finders.get(b.byName) ?? 0) + 1);
  const top = [...finders.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    name: r.bash.name,
    people: r.people,
    length: minutes === 60 ? "1 hour" : minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} min`,
    when: r.when,
    bugs: r.bugs.length,
    high: r.high,
    notes: r.notes,
    ideas: r.ideas,
    worst: r.worst.map((w) => ({ key: w.bug ? (w.bug.externalKey ?? `D-${w.bug.number}`) : null, url: w.bug?.externalUrl ?? null, severity: r.sevNames[w.severity] ?? w.severity, text: w.text })),
    byArea: r.byArea.map((a) => ({ name: a.name, bugs: a.bugs })),
    unanswered: r.unanswered,
    notFiled: r.notFiled,
    topFinder: top && top[1] > 0 ? { name: top[0], bugs: top[1] } : null,
    trophy: r.bash.funExtras,
    reportUrl: `${base}/p/${r.bash.project.key}/bashes/${bashId}/report`,
  };
}

// ---- Who gets it ----

/** The digest settings a test cycle uses: its umbrella's, its own, or none. */
export async function digestFor(projectId: string): Promise<{ settings: DigestSettings; teamIds: string[] } | null> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { id: true, groupId: true, emailDigestMode: true, emailDigest: true, hubOf: { select: { id: true, emailDigest: true, hubProjectId: true } } } });
  if (!p) return null;
  const umbrella = p.hubOf ?? (p.groupId ? await db.projectGroup.findFirst({ where: { id: p.groupId, hubProjectId: { not: null } }, select: { id: true, emailDigest: true, hubProjectId: true } }) : null);
  const teamIds = [p.id, ...(umbrella?.hubProjectId && umbrella.hubProjectId !== p.id ? [umbrella.hubProjectId] : [])];
  if (!umbrella || p.hubOf) return { settings: parseDigestSettings(umbrella && p.hubOf ? umbrella.emailDigest : p.emailDigest), teamIds };
  if (p.emailDigestMode === "off") return { settings: { ...DIGEST_DEFAULTS, on: false }, teamIds };
  return { settings: parseDigestSettings(p.emailDigestMode === "choose" ? p.emailDigest : umbrella.emailDigest), teamIds };
}

export type Recipient = { email: string; name: string; userId: string | null; why: string };

/**
 * Everyone this digest goes to, once each: the people the settings name (and their own
 * Emails I get choice), plus members who chose All, plus outside addresses that haven't stopped.
 */
export async function recipientsFor(projectId: string, kind: DigestKind, who: { testerIds: string[]; starterIds: (string | null)[] }): Promise<Recipient[]> {
  const d = await digestFor(projectId);
  if (!d || !sends(d.settings, kind)) return [];
  const s = d.settings;
  const groups = s.groupIds.length ? await db.emailGroup.findMany({ where: { id: { in: s.groupIds } } }) : [];
  const team = await db.projectMember.findMany({ where: { projectId: { in: d.teamIds } }, select: { userId: true } });
  const teamIds = new Set(team.map((m) => m.userId));
  const why = new Map<string, string>();
  const list = (id: string | null | undefined, reason: string) => id && !why.has(id) && why.set(id, reason);
  if (s.testers) for (const id of who.testerIds) list(id, kind === "bash" ? "You get this because you joined this bug bash." : "You get this because you tested in this run.");
  if (s.starter) for (const id of who.starterIds) list(id, `You get this because you started ${kind === "bash" ? "this bug bash" : kind === "rc" ? "one of its runs" : "this run"}.`);
  for (const g of groups) for (const id of g.userIds) list(id, `You get this because you're in the ${g.name} email group.`);
  if (s.everyone) for (const id of teamIds) list(id, "You get this because your team gets every one.");
  const extra = [...s.addresses, ...groups.flatMap((g) => g.addresses)];
  const users = await db.user.findMany({
    where: { OR: [{ id: { in: [...why.keys(), ...teamIds] } }, ...(extra.length ? [{ email: { in: extra, mode: "insensitive" as const } }] : [])] },
    select: { id: true, email: true, name: true, digestPrefs: true },
  });
  const out = new Map<string, Recipient>();
  for (const u of users) {
    const listedBy = why.get(u.id) ?? (extra.includes(u.email.toLowerCase()) ? "You get this because the team's Email digests name you." : null);
    const prefs = parsePrefs(u.digestPrefs);
    // Members who chose All get every one in the umbrellas they're on.
    const reason = listedBy ?? (teamIds.has(u.id) ? `You get this because you chose all ${kind === "bash" ? "bug bashes" : "runs"}.` : null);
    if (!reason || !memberGets(prefs, kind, !!listedBy)) continue;
    out.set(u.email.toLowerCase(), { email: u.email, name: u.name || u.email, userId: u.id, why: reason });
  }
  const ws = await db.workspace.findUnique({ where: { id: 1 }, select: { digestStopped: true } });
  const stopped = new Set(ws?.digestStopped ?? []);
  const known = new Set(users.map((u) => u.email.toLowerCase()));
  for (const e of extra) {
    if (known.has(e) || stopped.has(e) || out.has(e)) continue;
    const g = groups.find((x) => x.addresses.includes(e));
    out.set(e, { email: e, name: e, userId: null, why: g ? `You get this because you're in the ${g.name} email group in Flaw Patrol.` : "You get this because a Flaw Patrol team added your address to its digests." });
  }
  return [...out.values()];
}

/** The footer of one person's email: why they got it, and links to change or stop it. */
export function footerFor(r: Recipient, kind: DigestKind, base: string): Footer {
  return {
    reason: r.why,
    prefsUrl: r.userId ? `${base}/account#emails` : null,
    stopUrl: `${base}/stop-emails?t=${stopToken(r.email, kind)}`,
    stopLabel: !r.userId ? "Stop these emails" : kind === "run" ? "Stop run emails" : kind === "bash" ? "Stop bug bash emails" : "Stop release emails",
  };
}

/** Send one digest to everyone it's for. Each failure is logged; the rest still go. */
async function sendAll(recipients: Recipient[], kind: DigestKind, base: string, render: (f: Footer) => RenderedMail) {
  const ws = await mailSettings();
  if (!mailReady(ws) || !recipients.length) return 0;
  let sent = 0;
  for (const r of recipients) {
    try {
      const m = render(footerFor(r, kind, base));
      await sendMail({ to: r.email, subject: m.subject, lines: [], rich: { text: m.text, html: m.html } }, ws);
      sent++;
    } catch (e) {
      console.warn(`Digest email to ${r.email} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  return sent;
}

/** Run after the response when there is one, else now. */
export function later(job: () => Promise<unknown>) {
  const safe = () => job().catch((e) => console.warn("Digest email failed", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/** Run finished: the digest email. */
export async function emailRunDigest(cycle: CycleRef, runId: string, base: string, digest?: () => Promise<RunDigest | null>) {
  const run = await db.testRun.findUnique({ where: { id: runId }, select: { createdById: true, automated: true } });
  if (!run || run.automated) return 0;
  const testers = await db.testResult.findMany({ where: { runId, testerId: { not: null } }, distinct: ["testerId"], select: { testerId: true } });
  const recipients = await recipientsFor(cycle.id, "run", { testerIds: testers.map((t) => t.testerId!), starterIds: [run.createdById] });
  if (!recipients.length) return 0;
  const d = await (digest ? digest() : runDigest(cycle, runId, base));
  return d ? sendAll(recipients, "run", base, (f) => runEmail(d, f)) : 0;
}

/** Bug bash ended: the digest email, to the test cycle the bash ran in. */
export async function emailBashDigest(bashId: string, base: string) {
  const bash = await db.bugBash.findUnique({ where: { id: bashId }, select: { createdById: true, run: { select: { projectId: true } }, people: { select: { userId: true } }, items: { select: { byId: true } } } });
  if (!bash?.run) return 0;
  const joined = [...new Set([...bash.people.map((p) => p.userId), ...bash.items.map((i) => i.byId).filter((x): x is string => !!x)])];
  const recipients = await recipientsFor(bash.run.projectId, "bash", { testerIds: joined, starterIds: [bash.createdById] });
  if (!recipients.length) return 0;
  const d = await bashDigest(bashId, base);
  return d ? sendAll(recipients, "bash", base, (f) => bashEmail(d, f)) : 0;
}

/** Release testing done: the digest email to people who tested in any of the release's runs. */
export async function emailRcDigest(cycle: CycleRef, release: string, runIds: string[], digest: RcDigest, base: string) {
  const [testers, starters] = await Promise.all([
    db.testResult.findMany({ where: { runId: { in: runIds }, testerId: { not: null } }, distinct: ["testerId"], select: { testerId: true } }),
    db.testRun.findMany({ where: { id: { in: runIds } }, select: { createdById: true } }),
  ]);
  const all = await recipientsFor(cycle.id, "rc", { testerIds: testers.map((t) => t.testerId!), starterIds: starters.map((s) => s.createdById) });
  return sendAll(all, "rc", base, (f) => rcEmail({ ...digest, release }, f));
}

/** Send me a sample: the newest finished run (or bug bash) in this umbrella or test cycle, to me only. */
export async function sendSampleDigest(projectIds: string[], me: { id: string; email: string; name: string | null }, base: string) {
  const ws = await mailSettings();
  if (!mailReady(ws)) throw new Error("Email isn't set up for this workspace yet. A workspace admin sets it up in Workspace settings → Email.");
  const run = await db.testRun.findFirst({
    where: { projectId: { in: projectIds }, automated: false, kind: { not: "bash" }, results: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, project: { select: { id: true, key: true, name: true, platform: true, groupId: true } } },
  });
  const r: Recipient = { email: me.email, name: me.name || me.email, userId: me.id, why: "This is a sample you asked for. Real digests say why each person gets them." };
  if (run) {
    const d = await runDigest(run.project, run.id, base);
    if (d) {
      const m = runEmail(d, footerFor(r, "run", base));
      await sendMail({ to: me.email, subject: `Sample: ${m.subject}`, lines: [], rich: { text: m.text, html: m.html } }, ws);
      return `Sent a sample of ${d.runName} to ${me.email}.`;
    }
  }
  const bash = await db.bugBash.findFirst({ where: { run: { projectId: { in: projectIds } }, wrappedAt: { not: null } }, orderBy: { wrappedAt: "desc" }, select: { id: true } });
  const b = bash ? await bashDigest(bash.id, base) : null;
  if (!b) throw new Error("A sample needs one run with results, or a wrapped-up bug bash, here first.");
  const m = bashEmail(b, footerFor(r, "bash", base));
  await sendMail({ to: me.email, subject: `Sample: ${m.subject}`, lines: [], rich: { text: m.text, html: m.html } }, ws);
  return `Sent a sample of the ${b.name} bug bash to ${me.email}.`;
}
