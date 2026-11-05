// Bug templates: a list of templates per umbrella (or per test cycle outside one),
// built right in Flaw Patrol. Each one is a title shape and a list of headings, and each
// heading says where its text comes from. Pure, so the settings editor, the bug form, the
// server and the tests share it.

import { FIELD, templateKind, type ImportedTemplate, type TemplateSettings } from "./bug-template";

/** Where a heading's text comes from on a new bug. */
export const SOURCES = {
  steps: "Steps from the test case",
  expected: "Expected result of the failed step",
  actual: "The note from the failed step",
  env: "Run's release, build and environment",
  text: "A text box to write in",
  choice: "Choices to pick from",
  table: "A table",
  file: "A file to attach",
  empty: "Leave out",
} as const;
export type Source = keyof typeof SOURCES;

/** Headings filled in from the run. Steps and Expected need a test step; the others always have something. */
export const FROM_RUN: Source[] = ["steps", "expected", "actual", "env"];

/** What goes in a table column on each new row. */
export const COLUMN_FILLS = {
  now: "Date and time (automatic)",
  build: "Build number (automatic)",
  env: "Environment (automatic)",
  device: "Browser, device and OS (automatic)",
  who: "Who reported it (automatic)",
  files: "Attached files (automatic)",
  write: "You fill it in",
} as const;
export type ColumnFill = keyof typeof COLUMN_FILLS;

export type Column = { name: string; fill: ColumnFill };

export type Section = {
  id: string;
  heading: string;
  source: Source;
  /** Light text inside an empty box, like "Paste the crash log". */
  hint: string;
  /** For "Choices to pick from". */
  choices: string[];
  /** Must be filled in (or a file added) before the bug can be reported. */
  must: boolean;
  /** For "A file to attach": allowed endings like ".txt, .log"; blank means any file. */
  types: string;
  /** For "A file to attach": the person may paste the text instead. */
  paste: boolean;
  /** For "A table". */
  columns: Column[];
  /** For "A table": a bug's page offers "I saw it again", which adds a row. */
  growing: boolean;
};

export type BugLayout = {
  title: { platform: boolean; area: boolean; build: boolean };
  sections: Section[];
  /** A screenshot or video is needed before reporting. */
  shot: boolean;
  /** Jira fields copied from an example Jira bug (filled as an imported template fills them). */
  fields: ImportedTemplate["fields"];
  /** The Jira bug the layout was copied from, if any. */
  from: string;
};

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max = 100, n = 30) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

let seq = 0;
/** A short id for a new heading, unique within its template. */
export const newSectionId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankSection(source: Source = "text", heading = "New heading"): Section {
  return { id: newSectionId(), heading, source, hint: "", choices: source === "choice" ? ["Yes", "No"] : [], must: false, types: "", paste: false, columns: source === "table" ? reproColumns() : [], growing: source === "table" };
}

/** The Reproduction history columns (the team's detailed layout), a table's starting columns. */
export function reproColumns(): Column[] {
  return [
    { name: "Date & time", fill: "now" },
    { name: "Client version", fill: "build" },
    { name: "CSP", fill: "write" },
    { name: "Context", fill: "device" },
    { name: "User name & ID", fill: "who" },
    { name: "Env & tenant", fill: "env" },
    { name: "Repros", fill: "write" },
    { name: "Attachments", fill: "files" },
  ];
}

function parseSection(v: unknown, i: number): Section | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const heading = str(o.heading, 120);
  if (!heading) return null;
  const source = (typeof o.source === "string" && o.source in SOURCES ? o.source : "text") as Source;
  const columns = (Array.isArray(o.columns) ? o.columns : [])
    .map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      const fill = (typeof x.fill === "string" && x.fill in COLUMN_FILLS ? x.fill : "write") as ColumnFill;
      return { name: str(x.name, 60), fill };
    })
    .filter((c) => c.name)
    .slice(0, 12);
  return {
    id: str(o.id, 40) || `s${i}`,
    heading,
    source,
    hint: str(o.hint, 200),
    choices: strs(o.choices, 80, 20),
    must: o.must === true && canMust(source),
    types: str(o.types, 100),
    paste: o.paste === true,
    columns: source === "table" && !columns.length ? reproColumns() : columns,
    growing: o.growing === true,
  };
}

export function parseLayout(v: unknown): BugLayout {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const t = (o.title ?? {}) as Record<string, unknown>;
  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map(parseSection)
    .filter((x): x is Section => !!x)
    .slice(0, 30);
  const seen = new Set<string>();
  for (const s of sections) {
    while (seen.has(s.id)) s.id = `${s.id}x`;
    seen.add(s.id);
  }
  const fields = (Array.isArray(o.fields) ? o.fields : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      id: str(f.id, 60),
      name: str(f.name, 120),
      required: f.required === true,
      source: (["tester", "default", "release", "empty"].includes(f.source as string) ? f.source : "tester") as ImportedTemplate["fields"][number]["source"],
      value: strs(f.value, 500),
    }))
    .filter((f) => f.id && f.name)
    .slice(0, 60);
  return { title: { platform: t.platform !== false, area: t.area !== false, build: t.build === true }, sections, shot: o.shot === true, fields, from: str(o.from, 40) };
}

/** Which headings can be "Must have before reporting": the ones a person fills in. */
export const canMust = (s: Source) => s === "text" || s === "choice" || s === "actual" || s === "file";

export function blankLayout(): BugLayout {
  return {
    title: { platform: true, area: true, build: false },
    sections: [blankSection("steps", "Steps to reproduce"), blankSection("expected", "Expected"), blankSection("actual", "What happened"), blankSection("env", "Environment")],
    shot: false,
    fields: [],
    from: "",
  };
}

/** Write a bug (no test case): the built-in Plain choice, not saved as a team template. */
export const PLAIN_ID = "plain";
/** Send to Jira for a written bug: file it with the layout it was saved with. */
export const SAVED_ID = "saved";
/** Write a bug: the test cycle's own layout (Settings → Bug templates, first row), like a shared OKO layout. */
export const CURRENT_ID = "current";

/** A bug written on its own (Write a bug), not from a test: its saved layout says so. */
export const isWritten = (layout: unknown) => !!layout && typeof layout === "object" && (layout as { written?: unknown }).written === true;

/** Plain: three boxes to write in, so a bug that isn't from a test still reads like one. */
export function plainLayout(): BugLayout {
  const s = (id: string, heading: string, hint: string): Section => ({ ...blankSection("text", heading), id, hint });
  return {
    title: { platform: false, area: false, build: false },
    sections: [s("steps", "Steps to reproduce", "1. Open…\n2. Click…"), s("happened", "What happened", "What you saw"), s("expected", "What you expected", "What should have happened")],
    shot: false,
    fields: [],
    from: "",
  };
}

/** The ready-made detailed layout (the team's OB-5292 bug), as a template anyone can change. */
export function readyMadeLayout(): BugLayout {
  const s = (source: Source, heading: string, extra: Partial<Section> = {}) => ({ ...blankSection(source, heading), ...extra });
  return {
    title: { platform: true, area: true, build: false },
    sections: [
      s("text", "Issue observed on", { hint: "Which clients, like Unreal and Web" }),
      s("text", "Clients needed for repro"),
      s("actual", "Description"),
      s("text", "Threads", { hint: "Link to the Slack thread" }),
      s("table", "Reproduction history", { columns: reproColumns(), growing: true }),
      s("steps", "Repro steps"),
      s("text", "Bug impact"),
      s("text", "Bug workaround"),
    ],
    shot: false,
    fields: [],
    from: "",
  };
}

/** A layout copied from an example Jira bug (Settings → Import), as a template anyone can change. */
export function layoutFromImported(t: ImportedTemplate): BugLayout {
  const map: Record<string, Source> = { steps: "steps", expected: "expected", actual: "actual", env: "env", tester: "text", empty: "empty" };
  return {
    title: { platform: t.title.tag, area: t.title.feature, build: false },
    sections: t.sections.map((x) => blankSection(map[x.source] ?? "text", x.heading)),
    shot: false,
    fields: t.fields,
    from: t.from,
  };
}

/**
 * The first row of Settings → Bug templates (a copied Jira bug, or the detailed OB-5292 / OKO
 * layout) as a template, for Write a bug. Null when it's the plain one-line bug.
 * Section ids are fixed, so what the box sends matches the layout the server builds again.
 * Nothing comes from the test cycle's presets: a bug written on its own may be about another
 * product (an Unreal umbrella, a Unity bug; Scott, Nov 5), so Team, Client/SKUs and
 * Oly Environment start empty for the writer to pick.
 */
export function layoutFromSettings(t: TemplateSettings): BugLayout | null {
  const kind = templateKind(t);
  if (kind === "plain") return null;
  const layout = kind === "imported" && t.imported ? layoutFromImported(t.imported) : readyMadeLayout();
  const blankField = (name: string) => ({ id: name, name, required: false, source: "tester" as const, value: [] as string[] });
  return {
    ...layout,
    sections: layout.sections.map((s, i) => ({ ...s, id: `current-${i}` })),
    fields: kind === "imported" ? layout.fields.map((f) => (f.source === "default" ? { ...f, source: "tester" as const, value: [] } : f)) : [blankField(FIELD.team), blankField(FIELD.clients), blankField(FIELD.olyEnv)],
  };
}

/** "[Windows] - Checkout - 4.2.0-118 - App closes": blank parts are left out. */
export function layoutTitle(t: BugLayout["title"], p: { platform: string; area: string; build: string; summary: string }) {
  const tag = p.platform.trim().replace(/^\[|\]$/g, "");
  return [t.platform && tag && `[${tag}]`, t.area && p.area.trim(), t.build && p.build.trim(), p.summary.trim()].filter(Boolean).join(" - ").slice(0, 250);
}

/** One heading on a bug, as reported: its text, a table's rows, or the files added to it. */
export type Answer = {
  id: string;
  heading: string;
  source: Source;
  text: string;
  /** A table: its column names, and one list of cells per row. */
  columns?: Column[];
  rows?: string[][];
  growing?: boolean;
  /** Files added under this heading, by attachment id. */
  files?: { id: string; fileName: string }[];
};

/** What the run fills in: per source, plus the automatic table cells. */
export type RunFill = {
  steps: string;
  expected: string;
  actual: string;
  env: string;
  /** False when there's no test step to point at (a bug bash, an exploring session). */
  hasStep: boolean;
  failed: boolean;
};
export type AutoCells = { now: string; build: string; env: string; device: string; who: string };

/** A new table row: automatic cells filled, the rest blank (files are named when the bug is filed). */
export function autoRow(columns: Column[], auto: AutoCells): string[] {
  return columns.map((c) => (c.fill === "write" || c.fill === "files" ? "" : auto[c.fill]));
}

/**
 * The headings a new bug starts with. Steps and Expected have nothing to show without a
 * test step, so then they become text boxes (persona check, ver_119).
 */
export function startAnswers(layout: BugLayout, fill: RunFill, auto: AutoCells): Answer[] {
  return layout.sections
    .filter((s) => s.source !== "empty")
    .map((s) => {
      const noStep = (s.source === "steps" && !fill.hasStep) || (s.source === "expected" && !fill.failed);
      const source: Source = noStep ? "text" : s.source;
      const base: Answer = { id: s.id, heading: s.heading, source, text: "" };
      if (s.source === "steps" || s.source === "expected" || s.source === "actual" || s.source === "env") base.text = noStep ? "" : fill[s.source];
      if (s.source === "choice") base.text = "";
      if (s.source === "table") return { ...base, columns: s.columns, rows: [autoRow(s.columns, auto)], growing: s.growing };
      if (s.source === "file") return { ...base, files: [] };
      return base;
    });
}

/** The section of a layout an answer belongs to. */
export const sectionOf = (layout: BugLayout, a: { id: string }) => layout.sections.find((s) => s.id === a.id);

/** The headings still missing what they must have, plus the screenshot when one is needed. */
export function missing(layout: BugLayout, answers: Answer[], shots: number): string[] {
  const out: string[] = [];
  for (const a of answers) {
    const s = sectionOf(layout, a);
    if (!s?.must) continue;
    if (s.source === "file" ? !(a.files?.length || (s.paste && a.text.trim())) : !a.text.trim()) out.push(a.heading);
  }
  if (layout.shot && shots === 0) out.push("a screenshot or video");
  return out;
}

/** "Crash log and a screenshot or video". */
export const listWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** A table's files column gets the names of the bug's files, on the rows that left it blank. */
export function withFileNames(a: Answer, names: string[]): Answer {
  if (!a.columns || !a.rows) return a;
  const at = a.columns.findIndex((c) => c.fill === "files");
  if (at < 0) return a;
  return { ...a, rows: a.rows.map((r) => (r[at] ? r : r.map((c, i) => (i === at ? names.join("\n") || "None" : c)))) };
}

/** The bug as plain text, heading by heading: the description of a bug kept in Flaw Patrol. */
export function answersText(answers: Answer[]): string {
  const parts: string[] = [];
  for (const a of answers) {
    if (a.rows && a.columns) {
      const rows = a.rows.filter((r) => r.some((c) => c.trim()));
      if (!rows.length) continue;
      parts.push(`${a.heading}\n${rows.map((r) => a.columns!.map((c, i) => `${c.name}: ${(r[i] ?? "").replace(/\n/g, ", ") || "-"}`).join(" | ")).join("\n")}`);
      continue;
    }
    const files = (a.files ?? []).map((f) => f.fileName);
    const body = [a.text.trim(), files.length ? `Files: ${files.join(", ")}` : ""].filter(Boolean).join("\n");
    if (body) parts.push(`${a.heading}\n${body}`);
  }
  return parts.join("\n\n").slice(0, 60000);
}

/** The answers saved on a bug, read back safely. */
export function parseAnswers(v: unknown): Answer[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((o) => {
      const source = (typeof o.source === "string" && o.source in SOURCES ? o.source : "text") as Source;
      const a: Answer = { id: str(o.id, 40), heading: str(o.heading, 120), source, text: typeof o.text === "string" ? o.text.slice(0, 20000) : "" };
      if (Array.isArray(o.columns) && Array.isArray(o.rows)) {
        a.columns = parseSection({ heading: "x", source: "table", columns: o.columns }, 0)!.columns;
        a.rows = o.rows.filter(Array.isArray).map((r) => (r as unknown[]).map((c) => (typeof c === "string" ? c.slice(0, 2000) : ""))).slice(0, 200);
        a.growing = o.growing === true;
      }
      if (Array.isArray(o.files)) a.files = o.files.filter((f): f is Record<string, unknown> => !!f && typeof f === "object").map((f) => ({ id: str(f.id, 40), fileName: str(f.fileName, 200) }));
      return a;
    })
    .filter((a) => a.id && a.heading);
}

/** "pay-crash.txt" is allowed by ".txt, .log"; anything is allowed by a blank list. */
export function fileAllowed(types: string, fileName: string) {
  const ends = types
    .split(/[\s,;]+/)
    .map((t) => t.trim().toLowerCase().replace(/^\*?\.?/, "."))
    .filter((t) => t.length > 1);
  return !ends.length || ends.some((e) => fileName.toLowerCase().endsWith(e));
}

/** The file picker's accept list for ".txt, .log". */
export const acceptOf = (types: string) =>
  types
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^\*?\.?/, "."))
    .filter((t) => t.length > 1)
    .join(",");

/** "Oct 31, 2026, 6:14 PM PDT" in the reporter's own time zone (persona check: times say their zone). */
export function nowCell(d = new Date(), locale?: string) {
  try {
    // dateStyle can't be mixed with timeZoneName (it throws), so the parts are named one by one.
    return d.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  } catch {
    return d.toISOString();
  }
}

/** A browser and OS from a user agent: "Chrome 141 · Windows". */
export function deviceCell(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const version = (browser === "Edge" ? /Edg\/(\d+)/ : browser === "Chrome" ? /Chrome\/(\d+)/ : browser === "Firefox" ? /Firefox\/(\d+)/ : /Version\/(\d+)/).exec(ua)?.[1];
  const os = /Windows NT/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  return [browser && `${browser}${version ? ` ${version}` : ""}`, os].filter(Boolean).join(" · ");
}

/** Up to this many templates show as buttons in the bug form; more become a dropdown (Scott, ver_119). */
export const PICKER_BUTTONS = 5;
