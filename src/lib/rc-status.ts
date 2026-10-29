import { clockTime, shortDate, type Spelling } from "./spelling";
import type { ResultStatus, Severity } from "@prisma/client";
import { AE_SCALE, SEVERITIES, type SeverityScale } from "./severity";
import { chipFor } from "./sheet-colors";
import { isOpen, STATUS_LABEL, STATUS_STYLE, STATUSES } from "./status";

// The Release status block for end-of-day reports: one column per client run of a
// release, with the cycle sheet's "% run", today's progress and the
// bugs worth knowing about. Shared by the page, the Confluence copy and the image.

/** Case results that count as run: the same rule as the run page (see isOpen). */
export const DONE: ResultStatus[] = STATUSES.filter((s) => !isOpen(s));

/** "RC 22", "rc22" and "RC-22" are the same release. */
export const releaseKey = (release: string) => release.toLowerCase().replace(/[\s_-]+/g, "");

/** Which Jira release the Stories report shows: the one asked for, else the one the newest cycles test, else none (All). */
export function pickRelease(releases: string[], want: string | undefined, rcNames: string[]) {
  if (want === "all") return null;
  const asked = releases.find((r) => r === want);
  if (asked) return asked;
  return releases.find((r) => rcNames.some((n) => releaseKey(n) === releaseKey(r))) ?? null;
}

export type RcColumn = {
  id: string;
  href: string;
  /** The client under test, such as Unity, found in the run or project name. */
  label: string;
  runName: string;
  /** Every run in the column (ver_86: one column per client). */
  runIds: string[];
  /** The runs' names, listed small under the column when there's more than one. */
  runs: { name: string; href: string }[];
  build: string;
  /** Run fields shown on Release status cards, ready to print: "CSP 0.22.1 · Region EU" (ver_89). */
  extra: string;
  completed: boolean;
  total: number;
  done: number;
  counts: Partial<Record<ResultStatus, number>>;
  /** When each run case was last tested, to count today's progress in the viewer's own time zone. */
  testedAt: number[];
  severities: Partial<Record<Severity, number>>;
  /** The latest automation upload for this client and release (ver_82), shown as its own line. */
  automation?: { passed: number; total: number; build: string; href: string } | null;
  /** Regressions in this release that are still broken (ver_93), with their case keys. */
  regressions?: { count: number; keys: string[] } | null;
  /** A platform of the umbrella with no manual run yet (ver_94). */
  platform?: string;
  /** The Bug bash column, shown only with Include bug bashes on (ver_94). */
  bash?: boolean;
};

/** "🤖 Automation 412 / 430 passed · build 4812", or that nothing was uploaded. */
export function automationLine(c: RcColumn) {
  const a = c.automation;
  return a ? `🤖 Automation ${a.passed} / ${a.total} passed${a.build ? ` · build ${a.build}` : ""}` : "🤖 Automation: no upload yet";
}
/** Only reports with an upload somewhere get the Automation line. */
export const hasAutomation = (columns: RcColumn[]) => columns.some((c) => c.automation);

export type RcBug = {
  id: string;
  key: string;
  url: string | null;
  title: string;
  severity: Severity;
  /** Jira's Priority, set by producers; empty when unknown. */
  priority: string;
  status: string;
  clients: string[];
  /** Run cases the bug is linked to. */
  cases: string[];
  /** Logged in a bug bash (ver_94): tagged "from bug bash". */
  fromBash?: boolean;
};

export type RcRunChoice = { id: string; name: string; project: string; projectKey: string; number: number; release: string; on: boolean };

/** Runs someone unticked from a release, and runs from elsewhere they added to it. */
export type RcPick = { hide: string[]; add: string[]; /** Include bug bashes (ver_94), off unless switched on. */ bashes?: boolean };
export type RcPrefs = { release?: string; picks?: Record<string, RcPick> };

export function readPrefs(value: unknown): RcPrefs {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RcPrefs) : {};
}
export function pickFor(prefs: RcPrefs, release: string): RcPick {
  const p = prefs.picks?.[releaseKey(release)];
  return { hide: p?.hide ?? [], add: p?.add ?? [], bashes: p?.bashes === true };
}

/** " · Smoke, Explore checkout" when a column adds up more than one run. */
export const runsText = (c: Pick<RcColumn, "runs">) => (c.runs.length > 1 ? ` · ${c.runs.map((r) => r.name).join(", ")}` : "");

export const percent = (c: Pick<RcColumn, "done" | "total">) => (c.total ? Math.round((c.done / c.total) * 100) : 0);

export function stateOf(c: RcColumn) {
  if (c.total > 0 && c.done === c.total) return { label: "DONE", chip: chipFor("Passed") };
  // Closed before every case was run: finished, but say what was left.
  if (c.completed) return { label: `CLOSED · ${c.total - c.done} NOT RUN`, chip: chipFor("Untested") };
  const started = c.done > 0 || (c.counts.IN_PROGRESS ?? 0) > 0 || (c.counts.RETEST ?? 0) > 0;
  return started ? { label: "IN PROGRESS", chip: chipFor("In Progress") } : { label: "NOT STARTED", chip: chipFor("Untested") };
}

export function ranToday(c: RcColumn, now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return c.testedAt.filter((t) => t >= midnight).length;
}

/** Bar segments in the cycle sheet's order of results. */
export const BAR: ResultStatus[] = ["PASSED", "FAILED", "BLOCKED", "SKIPPED"];
export const barColor = (s: ResultStatus) => STATUS_STYLE[s].hex;

export function resultLine(c: RcColumn) {
  const parts = BAR.filter((s) => c.counts[s]).map((s) => `${c.counts[s]} ${STATUS_LABEL[s].toLowerCase()}`);
  return parts.length ? parts.join(" · ") : "No results yet";
}

export function bugLine(c: RcColumn, scale: SeverityScale = AE_SCALE) {
  // Enhancements aren't bugs worth counting in a status report. Names are the team's own (ver_91).
  // ver_94: the severity exactly as everywhere else ("1 bug: C - Problematic"), not a lowercased short name.
  const parts = SEVERITIES.filter((s) => s !== "ENHANCEMENT" && c.severities[s]).map((s) => `${c.severities[s]} ${c.severities[s] === 1 ? "bug" : "bugs"}: ${scale.labels[s]}`);
  return parts.length ? parts.join(" · ") : "No bugs filed";
}

export const severeCount = (c: RcColumn, scale: SeverityScale = AE_SCALE) => scale.critical.reduce((n, s) => n + (c.severities[s] ?? 0), 0);

/** The levels the team counts as critical, shown in red. */
export const severe = (b: Pick<RcBug, "severity">, scale: SeverityScale = AE_SCALE) => scale.critical.includes(b.severity);

export const asOfText = (d: Date, spelling: Spelling = "us") => `As of ${shortDate(d, spelling)}, ${clockTime(d, spelling)}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The block as plain HTML tables, which Confluence keeps when pasted: bold,
 * links, cell colors and text colors. Everything still reads without color.
 */
export function confluenceHtml(release: string, columns: RcColumn[], bugs: RcBug[], now = new Date(), spelling: Spelling = "us", scale: SeverityScale = AE_SCALE) {
  const cell = (c: RcColumn) => {
    const st = stateOf(c);
    const crit = severeCount(c, scale);
    return `<td style="text-align:center;vertical-align:top">
<p style="text-align:center"><strong>${esc(c.label)}</strong></p>
${c.build || c.extra ? `<p style="text-align:center">${esc([c.build, c.extra].filter(Boolean).join(" - "))}</p>` : ""}
<p style="text-align:center"><span style="background-color:${st.chip.fill};color:${st.chip.text}"><strong>&nbsp;${st.label}&nbsp;</strong></span></p>
<h2 style="text-align:center">${percent(c)}%</h2>
<p style="text-align:center">${c.done} of ${c.total} cases run · +${ranToday(c, now)} today</p>
${c.runs.length > 1 ? `<p style="text-align:center"><em>${esc(c.runs.map((r) => r.name).join(", "))}</em></p>` : ""}
<p style="text-align:center">${esc(resultLine(c))}</p>
<p style="text-align:center">${crit ? `<span style="color:#B10202"><strong>${esc(bugLine(c, scale))}</strong></span>` : esc(bugLine(c, scale))}</p>
${auto ? `<p style="text-align:center">${esc(automationLine(c))}</p>` : ""}
${c.regressions ? `<p style="text-align:center"><span style="color:#BE185D"><strong>${esc(regressionLine(c))}</strong></span></p>` : ""}
</td>`;
  };
  const auto = hasAutomation(columns);
  const bugRows = bugs
    .map(
      (b) => `<tr><td>${esc(b.clients.join(", "))}</td><td>${b.url ? `<a href="${esc(b.url)}">${esc(b.key)}</a>` : esc(b.key)} ${esc(b.title)}</td><td>${
        severe(b, scale) ? `<span style="color:#B10202"><strong>${esc(scale.labels[b.severity])}</strong></span>` : esc(scale.labels[b.severity])
      }</td><td>${esc(b.priority || "—")}</td><td>${esc(b.status)}</td><td>${b.cases.length} ${b.cases.length === 1 ? "case" : "cases"}</td></tr>`,
    )
    .join("\n");
  return `<h2 style="text-align:center">${esc(release.toUpperCase())} TESTING STATUS</h2>
<p style="text-align:center"><em>${esc(asOfText(now, spelling))}</em></p>
<table><tbody><tr>${columns.map(cell).join("\n")}</tr></tbody></table>
${
  bugs.length
    ? `<p><strong>Critical and blocking bugs</strong></p>
<table><tbody><tr><th>Client</th><th>Bug</th><th>Severity</th><th>Priority</th><th>Jira status</th><th>Cases</th></tr>
${bugRows}</tbody></table>`
    : `<p><strong>Critical and blocking bugs:</strong> none</p>`
}`;
}

/** The same block as text, for places that don't take formatting. */
export function plainText(release: string, columns: RcColumn[], bugs: RcBug[], now = new Date(), spelling: Spelling = "us", scale: SeverityScale = AE_SCALE) {
  const lines = [`${release.toUpperCase()} TESTING STATUS`, asOfText(now, spelling), ""];
  for (const c of columns) {
    lines.push(
      `${c.label}${c.build || c.extra ? ` (${[c.build, c.extra].filter(Boolean).join(" - ")})` : ""}: ${stateOf(c).label}, ${percent(c)}%`,
      `  ${c.done} of ${c.total} cases run${runsText(c)}, +${ranToday(c, now)} today. ${resultLine(c)}. ${bugLine(c, scale)}.`,
    );
    if (hasAutomation(columns)) lines.push(`  ${automationLine(c).replace("🤖 ", "")}.`);
    if (c.regressions) lines.push(`  ${regressionLine(c)}.`);
  }
  lines.push("", bugs.length ? "Critical and blocking bugs:" : "Critical and blocking bugs: none");
  for (const b of bugs) lines.push(`  ${b.key} ${b.title} (${[scale.labels[b.severity], b.priority, b.status, b.clients.join(", ")].filter(Boolean).join(", ")})`);
  return lines.join("\n");
}

/** "Regression: 2 (OKO-158, OKO-77 🤖)" for Release status copies (ver_93). */
export function regressionLine(c: RcColumn) {
  return c.regressions ? `Regression: ${c.regressions.count} (${c.regressions.keys.join(", ")})` : "";
}
