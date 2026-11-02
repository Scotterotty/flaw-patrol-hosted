// Bug templates in bug bashes: a bash picks a template, each bug logged in it keeps
// that template's layout, and what the template must have can be added later by anyone, up to
// wrap-up. Logging never waits on it (Scott, 2026-11-01): only filing does. Pure, client-safe.

import { listWords, missing, parseAnswers, parseLayout, type Answer, type AutoCells, type BugLayout } from "./bug-layout";

/** What someone typed or attached under a heading, by heading id. */
export type BashValues = Record<string, { text: string; files: { id: string; fileName: string }[] }>;

/** Headings a person fills in a bash. Tables and the run's details are filled in for them. */
export const typedSource = (s: BugLayout["sections"][number]) => s.source !== "empty" && s.source !== "env" && s.source !== "table";

/** Images and videos count as the screenshot a template can ask for. */
export const isShot = (f: { fileName: string; contentType?: string }) => (f.contentType ? /^(image|video)\//.test(f.contentType) : /\.(png|jpe?g|gif|webp|bmp|heic|mp4|mov|webm|mkv)$/i.test(f.fileName));

/**
 * A bash bug's answers from what was typed: every heading of the layout in order, Steps and
 * Expected as text boxes (bash areas have no test steps), the run's details under env headings,
 * and each table starting with one row of automatic cells.
 */
export function bashAnswers(layout: BugLayout, values: BashValues, fill: { env: string; actual: string }, auto: AutoCells): Answer[] {
  return layout.sections
    .filter((s) => s.source !== "empty")
    .map((s) => {
      const v = values[s.id];
      const source = s.source === "steps" || s.source === "expected" ? "text" : s.source;
      const base: Answer = { id: s.id, heading: s.heading, source, text: (v?.text ?? "").slice(0, 20000) };
      if (s.source === "env") return { ...base, text: fill.env };
      if (s.source === "actual" && !base.text.trim()) return { ...base, text: fill.actual };
      if (s.source === "table") return { ...base, text: "", columns: s.columns, rows: [s.columns.map((c) => (c.fill === "write" || c.fill === "files" ? "" : auto[c.fill]))], growing: s.growing };
      if (s.source === "file") return { ...base, files: (v?.files ?? []).slice(0, 10) };
      return base;
    });
}

/** Typed values back out of saved answers, so a form can start from them. */
export function valuesOf(answers: Answer[]): BashValues {
  return Object.fromEntries(answers.map((a) => [a.id, { text: a.text, files: a.files ?? [] }]));
}

/**
 * Fill in: what someone adds on top of what's there. A heading they typed in replaces
 * its text; files are added to the ones already there. Tables and env headings stay as they are.
 */
export function mergeValues(answers: Answer[], layout: BugLayout, values: BashValues): Answer[] {
  return answers.map((a) => {
    const s = layout.sections.find((x) => x.id === a.id);
    const v = values[a.id];
    if (!s || !v || !typedSource(s)) return a;
    const text = v.text.trim() ? v.text.slice(0, 20000) : a.text;
    if (s.source !== "file") return { ...a, text };
    const files = [...(a.files ?? [])];
    for (const f of v.files) if (!files.some((x) => x.id === f.id)) files.push(f);
    return { ...a, text, files: files.slice(0, 10) };
  });
}

/** What a bash bug still needs before it's filed: the heading ids and the words to show. */
export function needsOf(layout: BugLayout, answers: Answer[], files: { fileName: string; contentType?: string }[]) {
  const shots = files.filter(isShot).length;
  const words = missing(layout, answers, shots);
  const ids = answers.filter((a) => words.includes(a.heading) && layout.sections.some((s) => s.id === a.id && s.must)).map((a) => a.id);
  return { ids, words, shot: layout.shot && shots === 0 };
}

/** "Needs Steps to see it and a screenshot or video", the reason a bash bug isn't filed yet. */
export const needsLine = (words: string[]) => `Needs ${listWords(words)}`;
export const isNeedsLine = (why: string) => why.startsWith("Needs ");

/** A saved bash bug's template, read back safely. Null for a plain bug. */
export function itemTemplate(i: { templateName: string; layout: unknown; answers: unknown }) {
  if (!i.templateName || !i.layout) return null;
  return { name: i.templateName, layout: parseLayout(i.layout), answers: parseAnswers(i.answers) };
}

/** +1: one more row in each growing table, with the person's own automatic cells. */
export function withSeenRow(answers: Answer[], auto: AutoCells): Answer[] {
  return answers.map((a) => (a.growing && a.columns && a.rows ? { ...a, rows: [...a.rows, a.columns.map((c) => (c.fill === "write" || c.fill === "files" ? "" : auto[c.fill]))].slice(0, 200) } : a));
}

/** Taking a +1 back takes that person's last added row out again (never the first row). */
export function withoutSeenRow(answers: Answer[], who: string): Answer[] {
  return answers.map((a) => {
    if (!a.growing || !a.columns || !a.rows || a.rows.length < 2) return a;
    const at = a.columns.findIndex((c) => c.fill === "who");
    if (at < 0) return a;
    const last = a.rows.map((r, i) => (i > 0 && r[at] === who ? i : -1)).filter((i) => i >= 0).at(-1);
    return last === undefined ? a : { ...a, rows: a.rows.filter((_, i) => i !== last) };
  });
}

/** A bash bug's template for the screens: its layout and answers, and what it still needs. Null for a plain bug. */
export function findTemplate(i: { templateName: string; layout: unknown; answers: unknown }, files: { fileName: string; contentType?: string }[]) {
  const t = itemTemplate(i);
  if (!t) return null;
  const n = needsOf(t.layout, t.answers, files);
  return { name: t.name, layout: t.layout, answers: t.answers, needs: n.words, needIds: n.ids, shot: n.shot };
}
export type FindTemplate = NonNullable<ReturnType<typeof findTemplate>>;
