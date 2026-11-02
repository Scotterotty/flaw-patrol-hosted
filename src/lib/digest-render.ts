// Digests: what a finished run, an ended bug bash or a finished release says,
// in Slack (short, at most 3 of each list) and by email (every failure). Pure, so it's tested
// on its own; src/lib/digest-data.ts gathers the numbers.

import { joinAnd } from "./digest-settings";

export type Link = { key: string; url: string | null };
export type RunDigest = {
  where: string;
  runName: string;
  build: string;
  took: string | null;
  when: string;
  closedNotRun: number;
  total: number;
  done: number;
  passed: number;
  failed: number;
  blocked: number;
  passPct: number | null;
  /** Pass rate change vs the last finished run of the same kind on the same platform, in points. */
  vsLast: number | null;
  regressions: number;
  failures: { key: string; title: string; regression: boolean; tester: string; bug: Link | null }[];
  blockedCases: { key: string; comment: string }[];
  bugs: { key: string; url: string | null; title: string; severity: string; serious: boolean }[];
  testers: string[];
  runUrl: string;
  firstFailUrl: string | null;
};

export type BashDigest = {
  name: string;
  people: number;
  length: string;
  when: string;
  bugs: number;
  high: number;
  notes: number;
  ideas: number;
  worst: { key: string | null; url: string | null; severity: string; text: string }[];
  byArea: { name: string; bugs: number }[];
  unanswered: number;
  notFiled: number;
  topFinder: { name: string; bugs: number } | null;
  trophy: boolean;
  reportUrl: string;
};

export type RcDigest = { release: string; platforms: { name: string; passPct: number | null; notRun: number }[]; url: string };

export type Footer = { reason: string; prefsUrl: string | null; stopUrl: string; stopLabel: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Slack mrkdwn needs &, < and > escaped in anything people typed. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slackLink = (l: { key: string; url: string | null }) => (l.url ? `<${l.url}|${esc(l.key)}>` : esc(l.key));

export function vsText(points: number | null) {
  if (points === null) return "";
  if (points === 0) return "same as last run";
  return `${points > 0 ? "▲" : "▼"} ${Math.abs(points)}% vs last run`;
}

/** "Took 3 h 20 min", from the start to the end. */
export function tookText(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
  return plural(Math.round(min / (24 * 60)), "day");
}

export function countsLine(d: RunDigest) {
  return `${d.done} run · ${d.passed} passed · ${d.failed} failed · ${d.blocked} blocked${d.passPct !== null ? ` · ${d.passPct}% pass` : ""}`;
}

/** Failures with regressions first; the run's order otherwise. */
export function sortFailures<T extends { regression: boolean }>(list: T[]) {
  return [...list].sort((a, b) => Number(b.regression) - Number(a.regression));
}

/** The Slack run post with "Counts and what failed": at most 3 failures and 3 bugs, regressions first. */
export function runSlackLines(d: RunDigest) {
  const lines = [
    `*${esc(d.runName)}*${d.build ? ` · build ${esc(d.build)}` : ""}${d.took ? ` · took ${d.took}` : ""}${d.closedNotRun ? ` · closed with ${d.closedNotRun} not run` : ""}`,
    `${countsLine(d)}${d.vsLast !== null ? ` · ${vsText(d.vsLast)}` : ""}`,
  ];
  const fails = sortFailures(d.failures);
  if (fails.length) {
    lines.push("", "*What failed*");
    for (const f of fails.slice(0, 3)) lines.push(`${esc(f.key)} ${esc(f.title)}${f.regression ? " · *REGRESSION*" : ""}`);
    if (fails.length > 3) lines.push(`…and ${fails.length - 3} more`);
  }
  if (d.bugs.length) {
    const bugs = [...d.bugs].sort((a, b) => Number(b.serious) - Number(a.serious));
    lines.push("", "*Bugs filed*");
    for (const b of bugs.slice(0, 3)) lines.push(`${slackLink(b)} ${esc(b.severity)} · ${esc(b.title)}`);
    if (bugs.length > 3) lines.push(`…and ${bugs.length - 3} more`);
  }
  if (d.testers.length) lines.push("", `Tested by ${esc(joinAnd(d.testers))}`);
  return lines;
}

/** The Slack bug bash post with "Counts and top finds". */
export function bashSlackLines(d: BashDigest) {
  const lines = [[plural(d.people, "person", "people"), d.length, `${plural(d.bugs, "bug")}${d.high ? ` (${d.high} High or Blocker)` : ""}`, d.notes ? plural(d.notes, "note") : "", d.ideas ? plural(d.ideas, "idea") : ""].filter(Boolean).join(" · ")];
  if (d.worst.length) {
    lines.push("", "*Worst finds*");
    for (const w of d.worst) lines.push(`${w.key ? `${slackLink({ key: w.key, url: w.url })} ` : ""}${esc(w.severity)} · ${esc(w.text)}`);
  }
  const areas = d.byArea.filter((a) => a.bugs > 0);
  if (areas.length) lines.push("", "*By area*", areas.map((a) => `${esc(a.name)} ${a.bugs}`).join(" · "));
  const todo = stillToDo(d);
  if (todo) lines.push("", "*Still to do*", todo);
  if (d.topFinder) lines.push("", `Most bugs: ${esc(d.topFinder.name)} (${d.topFinder.bugs})${d.trophy ? " 🏆" : ""}`);
  return lines;
}

function stillToDo(d: BashDigest) {
  return [d.unanswered ? `${plural(d.unanswered, "question")} not answered` : "", d.notFiled ? `${plural(d.notFiled, "bug")} not filed yet` : ""].filter(Boolean).join(" · ");
}

// ---- Email ----

const h = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const BOX = `style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#1d1a2b;max-width:600px"`;
const MUTED = "color:#6a6680";
const button = (label: string, url: string) => `<p style="margin:20px 0"><a href="${h(url)}" style="background:#7442c8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600">${h(label)}</a></p>`;
const tile = (value: string, label: string, color = "#1d1a2b") =>
  `<td style="padding:10px 14px;border:1px solid #e4e1ee;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700;color:${color}">${h(value)}</div><div style="font-size:12px;${MUTED}">${label}</div></td>`;
const a = (l: Link) => (l.url ? `<a href="${h(l.url)}" style="color:#5b2fb0">${h(l.key)}</a>` : h(l.key));
const TAG = `<span style="background:#fde8e8;color:#b42318;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:700">REGRESSION</span>`;

function footerHtml(f: Footer) {
  return `<p style="margin:24px 0 0;font-size:12.5px;${MUTED}">${h(f.reason)}${f.prefsUrl ? ` <a href="${h(f.prefsUrl)}" style="color:#5b2fb0">Change which emails I get</a> ·` : ""} <a href="${h(f.stopUrl)}" style="color:#5b2fb0">${h(f.stopLabel)}</a></p>`;
}
function footerText(f: Footer) {
  return ["", "--", f.reason, ...(f.prefsUrl ? [`Change which emails I get: ${f.prefsUrl}`] : []), `${f.stopLabel}: ${f.stopUrl}`];
}

export type RenderedMail = { subject: string; text: string; html: string };

export function runSubject(d: RunDigest) {
  const bits = [d.passPct !== null ? `${d.passPct}% pass` : `${d.done} of ${d.total} run`, d.regressions ? plural(d.regressions, "regression") : d.failed ? `${d.failed} failed` : ""].filter(Boolean);
  return `${d.runName} on ${d.where} finished: ${bits.join(", ")}`;
}

export function runEmail(d: RunDigest, f: Footer): RenderedMail {
  const fails = sortFailures(d.failures);
  const vs = d.vsLast !== null && d.vsLast !== 0 ? ` <span style="font-size:12px;color:${d.vsLast < 0 ? "#b42318" : "#16794a"}">${d.vsLast < 0 ? "▼" : "▲"} ${Math.abs(d.vsLast)}%</span>` : "";
  const html = [
    `<div ${BOX}>`,
    `<h1 style="font-size:18px;margin:0 0 4px">${h(d.runName)} finished</h1>`,
    `<p style="margin:0 0 16px;${MUTED}">${h([d.where, d.build ? `build ${d.build}` : "", d.when].filter(Boolean).join(" · "))}${d.closedNotRun ? ` · closed with ${d.closedNotRun} not run` : ""}</p>`,
    `<table role="presentation" cellspacing="6" style="border-collapse:separate;margin:0 0 16px"><tr>`,
    `<td style="padding:10px 14px;border:1px solid #e4e1ee;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${d.passPct !== null ? `${d.passPct}%` : "–"}</div><div style="font-size:12px;${MUTED}">pass${vs}</div></td>`,
    tile(String(d.failed), "failed", d.failed ? "#b42318" : undefined),
    tile(String(d.blocked), "blocked", d.blocked ? "#b54708" : undefined),
    tile(String(d.bugs.length), d.bugs.length === 1 ? "bug filed" : "bugs filed"),
    `</tr></table>`,
    fails.length
      ? [
          `<table style="border-collapse:collapse;width:100%;margin:0 0 12px;font-size:13px"><tr style="text-align:left;${MUTED}"><th style="padding:6px 8px;border-bottom:1px solid #e4e1ee">What failed</th><th style="padding:6px 8px;border-bottom:1px solid #e4e1ee">Tester</th><th style="padding:6px 8px;border-bottom:1px solid #e4e1ee">Bug</th></tr>`,
          ...fails.map((x) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #f0eef5"><b>${h(x.key)}</b> ${h(x.title)} ${x.regression ? TAG : ""}</td><td style="padding:6px 8px;border-bottom:1px solid #f0eef5">${h(x.tester)}</td><td style="padding:6px 8px;border-bottom:1px solid #f0eef5">${x.bug ? a(x.bug) : `<span style="${MUTED}">none</span>`}</td></tr>`),
          `</table>`,
        ].join("")
      : `<p style="margin:0 0 12px">Nothing failed.</p>`,
    d.blockedCases.length ? `<p style="margin:0 0 12px">Blocked: ${h(blockedText(d))}</p>` : "",
    d.bugs.length ? `<p style="margin:0 0 12px">Bugs filed: ${d.bugs.map((b) => `${a(b)} ${h(b.severity)} · ${h(b.title)}`).join("<br>")}</p>` : "",
    d.testers.length ? `<p style="margin:0 0 12px">Tested by ${h(joinAnd(d.testers))}</p>` : "",
    button("Open the run in Flaw Patrol", d.runUrl),
    footerHtml(f),
    `</div>`,
  ].join("");
  const text = [
    `${d.runName} finished`,
    [d.where, d.build ? `build ${d.build}` : "", d.when].filter(Boolean).join(" · ") + (d.closedNotRun ? ` · closed with ${d.closedNotRun} not run` : ""),
    "",
    `${countsLine(d)}${d.vsLast !== null ? ` · ${vsText(d.vsLast)}` : ""}`,
    `${plural(d.bugs.length, "bug")} filed`,
    ...(fails.length ? ["", "What failed:", ...fails.map((x) => `- ${x.key} ${x.title}${x.regression ? " (REGRESSION)" : ""} · ${x.tester}${x.bug ? ` · ${x.bug.key}` : ""}`)] : ["", "Nothing failed."]),
    ...(d.blockedCases.length ? ["", `Blocked: ${blockedText(d)}`] : []),
    ...(d.bugs.length ? ["", "Bugs filed:", ...d.bugs.map((b) => `- ${b.key} ${b.severity} · ${b.title}`)] : []),
    ...(d.testers.length ? ["", `Tested by ${joinAnd(d.testers)}`] : []),
    "",
    `Open the run in Flaw Patrol: ${d.runUrl}`,
    ...footerText(f),
  ].join("\n");
  return { subject: runSubject(d), text, html };
}

function blockedText(d: RunDigest) {
  const keys = joinAnd(d.blockedCases.map((b) => b.key));
  const why = [...new Set(d.blockedCases.map((b) => b.comment.trim()).filter(Boolean))];
  return `${keys}${why.length ? ` (${why.slice(0, 2).map((w) => `"${w.slice(0, 120)}"`).join(", ")})` : ""}.`;
}

export function bashSubject(d: BashDigest) {
  return `${d.name} bug bash ended: ${plural(d.bugs, "bug")}${d.high ? ` (${d.high} High or Blocker)` : ""}`;
}

export function bashEmail(d: BashDigest, f: Footer): RenderedMail {
  const areas = d.byArea.filter((x) => x.bugs > 0);
  const todo = stillToDo(d);
  const html = [
    `<div ${BOX}>`,
    `<h1 style="font-size:18px;margin:0 0 4px">${h(d.name)} bug bash ended</h1>`,
    `<p style="margin:0 0 16px;${MUTED}">${h(d.when)}</p>`,
    `<table role="presentation" cellspacing="6" style="border-collapse:separate;margin:0 0 16px"><tr>`,
    tile(String(d.people), d.people === 1 ? "person" : "people"),
    tile(String(d.bugs), d.bugs === 1 ? "bug" : "bugs", d.bugs ? "#b42318" : undefined),
    tile(String(d.high), "High or Blocker"),
    tile(String(d.notes + d.ideas), "notes and ideas"),
    `</tr></table>`,
    d.worst.length ? `<p style="margin:0 0 4px;font-weight:600">Worst finds</p><p style="margin:0 0 12px">${d.worst.map((w) => `${w.key ? `${a({ key: w.key, url: w.url })} ` : ""}${h(w.severity)} · ${h(w.text)}`).join("<br>")}</p>` : "",
    areas.length ? `<p style="margin:0 0 4px;font-weight:600">By area</p><p style="margin:0 0 12px">${areas.map((x) => `${h(x.name)} ${x.bugs}`).join(" · ")}</p>` : "",
    todo ? `<p style="margin:0 0 4px;font-weight:600">Still to do</p><p style="margin:0 0 12px">${h(todo)}</p>` : "",
    d.topFinder ? `<p style="margin:0 0 12px">Most bugs: ${h(d.topFinder.name)} (${d.topFinder.bugs})${d.trophy ? " 🏆" : ""}</p>` : "",
    button("See the report", d.reportUrl),
    footerHtml(f),
    `</div>`,
  ].join("");
  const text = [
    `${d.name} bug bash ended`,
    d.when,
    "",
    bashSlackLines(d)[0],
    ...(d.worst.length ? ["", "Worst finds:", ...d.worst.map((w) => `- ${w.key ? `${w.key} ` : ""}${w.severity} · ${w.text}`)] : []),
    ...(areas.length ? ["", `By area: ${areas.map((x) => `${x.name} ${x.bugs}`).join(" · ")}`] : []),
    ...(todo ? ["", `Still to do: ${todo}`] : []),
    ...(d.topFinder ? ["", `Most bugs: ${d.topFinder.name} (${d.topFinder.bugs})`] : []),
    "",
    `See the report: ${d.reportUrl}`,
    ...footerText(f),
  ].join("\n");
  return { subject: bashSubject(d), text, html };
}

const rcLabel = (p: RcDigest["platforms"][number]) => (p.notRun ? `closed, ${p.notRun} not run` : `${p.passPct ?? 0}% pass`);

export function rcEmail(d: RcDigest, f: Footer): RenderedMail {
  const subject = `${d.release} testing done: ${d.platforms.map((p) => `${p.name} ${rcLabel(p)}`).join(" · ")}`;
  const html = [
    `<div ${BOX}>`,
    `<h1 style="font-size:18px;margin:0 0 12px">${h(d.release)} testing done</h1>`,
    `<table style="border-collapse:collapse;margin:0 0 12px;font-size:13px">${d.platforms.map((p) => `<tr><td style="padding:6px 12px 6px 0;font-weight:600">${h(p.name)}</td><td style="padding:6px 0">${h(rcLabel(p))}</td></tr>`).join("")}</table>`,
    button("Open release status", d.url),
    footerHtml(f),
    `</div>`,
  ].join("");
  const text = [`${d.release} testing done`, "", ...d.platforms.map((p) => `${p.name}: ${rcLabel(p)}`), "", `Open release status: ${d.url}`, ...footerText(f)].join("\n");
  return { subject, text, html };
}
