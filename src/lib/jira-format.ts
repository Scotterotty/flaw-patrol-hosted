// Builds the Jira bug body (Atlassian Document Format) from a failed test.
// Pure so it's unit tested and previewed in the browser before filing.

import { withBracketTags } from "./tags";
import { isDxdiag, orderFiles, type TemplateBug } from "./bug-template";
import type { Answer } from "./bug-layout";

export type BugContext = {
  caseKey: string;
  caseTitle: string;
  runLabel: string;
  build: string;
  /** The run's release. */
  release?: string;
  cspVersion?: string;
  /** Run fields ticked "Add to Jira bugs". When set, these are used instead of cspVersion. */
  fields?: { name: string; value: string }[];
  environment: string;
  preconditions: string;
  /** Test data: which row failed and its values, like "Test data row 2 of 3: role = viewer". */
  testRow?: string;
  /** Test data: the row's short label, like "Safari · viewer", added to the end of the summary. */
  rowName?: string;
  steps: { number: string; action: string; expected: string }[];
  failedIndex: number | null; // 0-based; null when filed for the whole case
  actual: string;
  link: string | null;
  // Set when Jira can't show the tester as the bug's Reporter, so their name is in the text instead.
  reportedBy?: string | null;
  /** Bracket tags the summary puts back in front, like [WEB]. */
  titleTags?: string[];
};

/** The first line of a step or note, trimmed to a readable length. */
const short = (s: string, max: number) => {
  const line = s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** "Payment sheet opens" → "Payment sheet does not open", for a title when nothing was typed. */
export function didNot(expected: string) {
  const text = short(expected, 80).replace(/[.!]+$/, "");
  if (!text) return "";
  const words = text.split(/\s+/);
  const be = words.findIndex((w, i) => i > 0 && /^(is|are|was|were|can|will|should)$/i.test(w));
  if (be > 0) return [...words.slice(0, be + 1), "not", ...words.slice(be + 1)].join(" ");
  const verb = words.findIndex((w, i) => i > 0 && /^[a-z]{3,}s$/.test(w) && !/ss$/.test(w));
  if (verb > 0) return [...words.slice(0, verb), "does not", words[verb].slice(0, -1), ...words.slice(verb + 1)].join(" ");
  return `Not as expected: ${text}`;
}

/** A real bug title from what's on screen: case title, the step, and what happened (or what didn't). */
export function bugTitle(caseTitle: string, step: { action: string; expected: string } | null, actual: string) {
  const what = short(actual, 90) || (step ? didNot(step.expected) : "");
  return [caseTitle.trim(), step && short(step.action, 60), what].filter(Boolean).join(": ").slice(0, 250);
}

export function defaultSummary(ctx: Pick<BugContext, "caseTitle" | "steps" | "failedIndex" | "actual" | "titleTags" | "rowName">): string {
  const step = ctx.failedIndex === null ? null : (ctx.steps[ctx.failedIndex] ?? null);
  const title = bugTitle(ctx.caseTitle, step, ctx.actual ?? "");
  return withBracketTags(ctx.titleTags ?? [], ctx.rowName ? `${title} (${ctx.rowName})` : title).slice(0, 250);
}

/** Plain-text version, shown as the preview in the dialog. */
export function bugText(ctx: BugContext): string {
  const upto = ctx.failedIndex === null ? ctx.steps : ctx.steps.slice(0, ctx.failedIndex + 1);
  const failed = ctx.failedIndex === null ? null : ctx.steps[ctx.failedIndex];
  const lines = [
    ctx.reportedBy && `Reported by: ${ctx.reportedBy} (via Flaw Patrol)`,
    `Found while running ${ctx.caseKey} "${ctx.caseTitle}" in ${ctx.runLabel}.`,
    [ctx.build && `Build: ${ctx.build}`, ...fieldLines(ctx), ctx.environment && `Environment: ${ctx.environment}`].filter(Boolean).join(" · "),
    ctx.preconditions && `Preconditions: ${ctx.preconditions}`,
    ctx.testRow,
    "",
    "Steps to reproduce:",
    ...upto.map((s, i) => `${i + 1}. ${s.action}`),
    "",
    failed?.expected && `Expected: ${failed.expected}`,
    `Actual: ${ctx.actual || "(not described)"}`,
    ctx.link && `\nTest result: ${ctx.link}`,
  ];
  return lines.filter((l): l is string => typeof l === "string").join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type Node = Record<string, unknown>;
const text = (t: string, marks?: Node[]): Node => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (...content: Node[]): Node => ({ type: "paragraph", content: content.filter((c) => c.text !== "") });
const bold = (t: string) => text(t, [{ type: "strong" }]);

export function bugAdf(ctx: BugContext): Node {
  const upto = ctx.failedIndex === null ? ctx.steps : ctx.steps.slice(0, ctx.failedIndex + 1);
  const failed = ctx.failedIndex === null ? null : ctx.steps[ctx.failedIndex];
  const content: Node[] = [para(text(`Found while running ${ctx.caseKey} "${ctx.caseTitle}" in ${ctx.runLabel}.`))];
  if (ctx.reportedBy) content.unshift(para(bold("Reported by: "), text(`${ctx.reportedBy} (via Flaw Patrol)`)));
  const env = [ctx.build && `Build: ${ctx.build}`, ...fieldLines(ctx), ctx.environment && `Environment: ${ctx.environment}`].filter(Boolean).join(" · ");
  if (env) content.push(para(text(env)));
  if (ctx.preconditions) content.push(para(bold("Preconditions: "), text(ctx.preconditions)));
  if (ctx.testRow) content.push(para(text(ctx.testRow)));
  if (upto.length) {
    content.push(para(bold("Steps to reproduce")));
    content.push({
      type: "orderedList",
      content: upto.map((s) => ({ type: "listItem", content: [para(text(s.action || "(no action text)"))] })),
    });
  }
  if (failed?.expected) content.push(para(bold("Expected: "), text(failed.expected)));
  content.push(para(bold("Actual: "), text(ctx.actual || "(not described)")));
  if (ctx.link) content.push(para(text("Test result: "), text(ctx.link, [{ type: "link", attrs: { href: ctx.link } }])));
  return { type: "doc", version: 1, content };
}

/** Lines of text as one paragraph, with line breaks kept. */
function paraLines(t: string, marks?: Node[]): Node {
  const content: Node[] = [];
  t.split("\n").forEach((line, i) => {
    if (i) content.push({ type: "hardBreak" });
    if (line) content.push(text(line, marks));
  });
  return { type: "paragraph", content };
}

/** Plain text as a rich-text (ADF) document: blank lines split paragraphs. */
export function richText(t: string): Node {
  const paras = t.trim().split(/\n\s*\n/).filter((p) => p.trim());
  return { type: "doc", version: 1, content: paras.length ? paras.map((p) => paraLines(p.trim())) : [para()] };
}

const link = (label: string, href?: string) => text(label, href ? [{ type: "link", attrs: { href } }] : undefined);

/** A file put on the issue: a link once Jira has it, and a media id when it can show inline. */
export type FileRef = { fileName: string; contentType: string; url?: string; mediaId?: string };

export const HISTORY_HEADERS = ["DATE & TIME", "CLIENT", "CSP", "Context", "User Name & ID", "ENV. & TENANT", "REPROS", "ATTACHMENTS"];

/**
 * The template's description: Issue Observed on, Clients Needed for Repro, what
 * happened, THREADS (only with a Slack link), screenshots and videos, logs, then
 * the Reproduction History table. `extra` holds template fields this Jira
 * doesn't have, so nothing typed is lost.
 */
export function templateAdf(b: TemplateBug, opts: { reportedBy?: string | null; files: FileRef[]; extra?: { name: string; text: string }[]; trace?: { label: string; link: string | null } }): Node {
  const content: Node[] = [];
  if (opts.reportedBy) content.push(para(bold("Reported by: "), text(`${opts.reportedBy} (via Flaw Patrol)`)));
  content.push(para(bold("Issue Observed on: "), text(b.observedOn.trim() || "...")));
  content.push(para(bold("Clients Needed for Repro: "), text(b.clientsNeeded.trim() || "...")));
  content.push({ type: "rule" });
  for (const p of (b.what.trim() || "...").split(/\n\s*\n/)) content.push(paraLines(p.trim()));
  if (b.slack.trim()) {
    content.push(para(bold("THREADS")));
    content.push({ type: "bulletList", content: [{ type: "listItem", content: [para(link(b.slack.trim(), /^https?:\/\//i.test(b.slack.trim()) ? b.slack.trim() : undefined))] }] });
  }
  const { media, logs } = orderFiles(opts.files);
  if (media.length) {
    content.push(para(bold("SCREENSHOTS & VIDEOS")));
    for (const f of media)
      content.push(
        f.mediaId
          ? { type: "mediaSingle", attrs: { layout: "align-start" }, content: [{ type: "media", attrs: { type: "file", id: f.mediaId, collection: "" } }] }
          : para(link(f.fileName, f.url)),
      );
  }
  if (logs.length) {
    content.push(para(bold("LOGS")));
    content.push({ type: "bulletList", content: logs.map((f) => ({ type: "listItem", content: [para(link(f.fileName, f.url))] })) });
  }
  const h = b.history;
  const listed = opts.files.filter((f) => !isDxdiag(f.fileName));
  const attachCell: Node = {
    type: "paragraph",
    content: listed.length ? listed.flatMap((f, i) => [...(i ? [{ type: "hardBreak" }] : []), link(f.fileName, f.url)]) : [text("None")],
  };
  const cell = (t: string): Node => ({ type: "tableCell", attrs: {}, content: [paraLines(t.trim() || "-")] });
  content.push(para(bold("REPRODUCTION HISTORY")));
  content.push({
    type: "expand",
    attrs: { title: "Click here to expand..." },
    content: [
      {
        type: "table",
        attrs: { isNumberColumnEnabled: false, layout: "default" },
        content: [
          { type: "tableRow", content: HISTORY_HEADERS.map((t) => ({ type: "tableHeader", attrs: {}, content: [para(bold(t))] })) },
          {
            type: "tableRow",
            content: [cell(h.dateTime), cell(h.client), cell(h.csp), cell(h.context), cell(h.user), cell(h.envTenant), cell(h.repros), { type: "tableCell", attrs: {}, content: [attachCell] }],
          },
        ],
      },
    ],
  });
  const extra = (opts.extra ?? []).filter((e) => e.text.trim());
  if (extra.length) {
    content.push({ type: "rule" });
    for (const e of extra) {
      content.push(para(bold(e.name)));
      for (const p of e.text.trim().split(/\n\s*\n/)) content.push(paraLines(p.trim()));
    }
  }
  if (opts.trace) content.push(para(text("Filed from Flaw Patrol: "), link(opts.trace.label, opts.trace.link ?? undefined)));
  return { type: "doc", version: 1, content };
}

/** Recognize a Jira issue key typed or pasted (also from a browse URL). */
export function parseIssueKey(input: string): string | null {
  const m = input.trim().match(/(?:^|\/browse\/|selectedIssue=)([A-Z][A-Z0-9_]+-\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Text as ADF blocks: lines all numbered "1. …" become a numbered list, the rest paragraphs. */
function blocks(t: string): Node[] {
  const lines = t.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((l) => /^\d+[.)]\s+/.test(l)))
    return [{ type: "orderedList", content: lines.map((l) => ({ type: "listItem", content: [para(text(l.replace(/^\d+[.)]\s+/, "")))] })) }];
  return t
    .trim()
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => paraLines(p.trim()));
}

/**
 * An imported template's description: each heading from the example bug in bold,
 * with this bug's text under it. Empty sections are left out, so Jira
 * never gets a heading with nothing under it. `extra` holds fields Jira refused, so nothing typed is lost.
 */
export function importedAdf(sections: { heading: string; text: string }[], opts: { reportedBy?: string | null; extra?: { name: string; text: string }[]; trace?: { label: string; link: string | null } }): Node {
  const content: Node[] = [];
  if (opts.reportedBy) content.push(para(bold("Reported by: "), text(`${opts.reportedBy} (via Flaw Patrol)`)));
  for (const s of sections.filter((x) => x.text.trim())) {
    content.push(para(bold(s.heading)));
    content.push(...blocks(s.text));
  }
  const extra = (opts.extra ?? []).filter((e) => e.text.trim());
  if (extra.length) {
    content.push({ type: "rule" });
    for (const e of extra) {
      content.push(para(bold(e.name)));
      content.push(...blocks(e.text));
    }
  }
  if (opts.trace) content.push(para(text("Filed from Flaw Patrol: "), link(opts.trace.label, opts.trace.link ?? undefined)));
  return { type: "doc", version: 1, content };
}

const tableCell = (t: string, header = false): Node => ({ type: header ? "tableHeader" : "tableCell", attrs: {}, content: [header ? para(bold(t)) : paraLines(t.trim() || "-")] });
const tableRow = (cells: string[]): Node => ({ type: "tableRow", content: cells.map((c) => tableCell(c)) });

/** A template table as a Jira table: a header row of column names, then the rows with anything in them. Null when no row has. */
function answerTable(a: Answer): Node | null {
  const rows = (a.rows ?? []).filter((r) => r.some((c) => c.trim()));
  if (!a.columns || !rows.length) return null;
  return {
    type: "table",
    attrs: { isNumberColumnEnabled: false, layout: "default" },
    content: [{ type: "tableRow", content: a.columns.map((c) => tableCell(c.name, true)) }, ...rows.map((r) => tableRow(a.columns!.map((_, i) => r[i] ?? "")))],
  };
}

/** All the words in a piece of Jira's document, run together. */
function plain(n: unknown): string {
  if (!n || typeof n !== "object") return "";
  const o = n as { text?: unknown; content?: unknown };
  return (typeof o.text === "string" ? o.text : "") + (Array.isArray(o.content) ? o.content.map(plain).join(" ") : "");
}
const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * I saw it again: the bug's description as it is in Jira now, with one row added to the
 * end of that heading's table. Everything else stays as Jira has it, edits made there included.
 * The table is the one under the heading, or else the one whose header row has the same column
 * names. When neither is there (someone took it out in Jira), the heading and table go at the end.
 */
export function addRowToAdf(description: unknown, a: Answer, row: string[]): Node {
  const doc = description && typeof description === "object" && Array.isArray((description as Node).content) ? (description as Node) : { type: "doc", version: 1, content: [] };
  const content = [...(doc.content as Node[])];
  const isTable = (n: Node | undefined) => n?.type === "table" && Array.isArray(n.content);
  const header = (n: Node) => ((n.content as Node[])[0]?.content as Node[] | undefined)?.map(plain) ?? [];
  const columns = (a.columns ?? []).map((c) => c.name);
  let at = content.findIndex((n, i) => isTable(n) && i > 0 && content[i - 1].type === "paragraph" && same(plain(content[i - 1]), a.heading));
  if (at < 0) at = content.findIndex((n) => isTable(n) && header(n).length === columns.length && header(n).every((h, i) => same(h, columns[i])));
  if (at >= 0) {
    const table = content[at];
    const width = Math.max(header(table).length, 1);
    const cells = Array.from({ length: width }, (_, i) => row[i] ?? "");
    content[at] = { ...table, content: [...(table.content as Node[]), tableRow(cells)] };
    return { ...doc, content };
  }
  const table = answerTable(a);
  if (!table) return { ...doc, content };
  // Before the "Filed from Flaw Patrol" line when it's last, so that line stays at the bottom.
  const last = content.at(-1);
  const end = last && last.type === "paragraph" && plain(last).startsWith("Filed from Flaw Patrol") ? content.length - 1 : content.length;
  content.splice(end, 0, para(bold(a.heading)), table);
  return { ...doc, content };
}

/**
 * A bug reported with a bug template: each heading in bold with its text, tables as
 * Jira tables, and the files added under a heading as links. Headings left empty are skipped.
 */
export function answersAdf(
  answers: Answer[],
  opts: { reportedBy?: string | null; extra?: { name: string; text: string }[]; trace?: { label: string; link: string | null }; fileUrl?: (id: string) => string | undefined } = {},
): Node {
  const content: Node[] = [];
  if (opts.reportedBy) content.push(para(bold("Reported by: "), text(`${opts.reportedBy} (via Flaw Patrol)`)));
  for (const a of answers) {
    if (a.columns && a.rows) {
      const table = answerTable(a);
      if (!table) continue;
      content.push(para(bold(a.heading)), table);
      continue;
    }
    const files = a.files ?? [];
    if (!a.text.trim() && !files.length) continue;
    content.push(para(bold(a.heading)));
    if (a.text.trim()) content.push(...(a.source === "file" ? [{ type: "codeBlock", attrs: {}, content: [text(a.text.trim().slice(0, 30000))] }] : blocks(a.text)));
    if (files.length) content.push({ type: "bulletList", content: files.map((f) => ({ type: "listItem", content: [para(link(f.fileName, opts.fileUrl?.(f.id)))] })) });
  }
  const extra = (opts.extra ?? []).filter((e) => e.text.trim());
  if (extra.length) {
    content.push({ type: "rule" });
    for (const e of extra) {
      content.push(para(bold(e.name)));
      content.push(...blocks(e.text));
    }
  }
  if (opts.trace) content.push(para(text("Filed from Flaw Patrol: "), link(opts.trace.label, opts.trace.link ?? undefined)));
  return { type: "doc", version: 1, content };
}

/** What each section of an imported template starts with on a new bug, from the failed test. */
export function sectionText(source: string, ctx: BugContext) {
  const upto = ctx.failedIndex === null ? ctx.steps : ctx.steps.slice(0, ctx.failedIndex + 1);
  const failed = ctx.failedIndex === null ? null : ctx.steps[ctx.failedIndex];
  if (source === "steps") return [ctx.preconditions && `Preconditions: ${ctx.preconditions}`, ctx.testRow, ...upto.map((s, i) => `${i + 1}. ${s.action || "(no action text)"}`)].filter(Boolean).join("\n");
  if (source === "expected") return failed?.expected ?? "";
  if (source === "actual") return ctx.actual;
  if (source === "env") return [ctx.release && `Release: ${ctx.release}`, ctx.build && `Build: ${ctx.build}`, ...fieldLines(ctx), ctx.environment && `Environment: ${ctx.environment}`].filter(Boolean).join("\n");
  return "";
}

/** "CSP version: 0.22.1", "Firmware: 3.1": the run fields a bug's text carries. */
function fieldLines(ctx: BugContext) {
  const fields = ctx.fields ?? (ctx.cspVersion ? [{ name: "CSP version", value: ctx.cspVersion }] : []);
  return fields.filter((f) => f.value).map((f) => `${f.name}: ${f.value}`);
}
