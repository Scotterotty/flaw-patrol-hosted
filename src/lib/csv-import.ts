import type { CaseType, Priority } from "@prisma/client";
import type { PlainStep } from "./steps";

// Turns spreadsheet rows into test cases. Handles the two layouts most tools
// export: all steps of a case in one cell (one per line, often numbered), and
// one row per step where follow-on rows either leave the title blank
// (TestRail, Zephyr, Xray) or repeat the case's ID (qTest). Pure so it runs in the browser for the preview and
// on the server for the real import.

export const IMPORT_FIELDS = [
  "title",
  "folder",
  "priority",
  "tags",
  "preconditions",
  "steps",
  "expected",
  "testData",
  "description",
  "requirements",
  "type",
  "automationId",
  "sourceId",
  "stepOrder",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, number>>;

export const FIELD_LABEL: Record<ImportField, string> = {
  title: "Title",
  folder: "Folder",
  priority: "Priority",
  tags: "Tags",
  preconditions: "Preconditions",
  steps: "Steps",
  expected: "Expected results",
  testData: "Test data (added to each step)",
  description: "Description (added above preconditions)",
  requirements: "Jira requirements (Requirements, Jira or Story column)",
  type: "Type",
  automationId: "Automation ID",
  sourceId: "Case ID in old tool",
  stepOrder: "Step order (keeps 1.1, 2.1 groups)",
};

const HEADER_GUESSES: Record<ImportField, RegExp> = {
  title: /^(title|summary|name|test ?case( ?name| ?title)?|case|test ?name)$/i,
  folder: /^(folder|section|suite|component|path|area|module)$/i,
  priority: /^priority$/i,
  tags: /^(tags?|labels?|keywords?)$/i,
  preconditions: /^(pre-?conditions?|prerequisites?|setup)$/i,
  steps: /^((test )?steps?( \(?steps\)?| action| description)?|actions?|step ?\(?action\)?)$/i,
  expected: /^(expected( results?)?|(test )?steps? ?\(?expected( results?)?\)?|expected outcome)$/i,
  testData: /^(test ?data|data)$/i,
  description: /^(description|objective|summary)$/i,
  requirements: /^(requirements?( ids?)?|references?|refs|coverage( \(issues\))?|stor(y|ies)( keys?)?|jira( keys?| issues?| stor(y|ies))?)$/i,
  type: /^(type|case type|test type)$/i,
  automationId: /^(automation ?(id|key)?|automation ?content)$/i,
  sourceId: /^(id|key|(test ?)?case ?(id|key|#)|test ?id|issue ?key|external ?id)$/i,
  stepOrder: /^(test )?step ?(order|#|no\.?|number)$/i,
};

// Where the file came from. Each tool names its export columns its own way;
// knowing the tool lets us match them exactly before falling back to guesses.
export const IMPORT_SOURCES = [
  { id: "qtest", label: "qTest" },
  { id: "testrail", label: "TestRail" },
  { id: "zephyr", label: "Zephyr Scale" },
  { id: "xray", label: "Xray" },
  { id: "other", label: "Excel or another tool" },
] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number]["id"];

const SOURCE_HEADERS: Record<ImportSource, Partial<Record<ImportField, RegExp>>> = {
  // qTest Manager's test case export (Test Case Detail report), and the
  // test run export from Test Execution, which names its columns a bit differently.
  qtest: {
    sourceId: /^(id|key|test ?case ?id|pid)$/i,
    title: /^(name|test ?case ?name)$/i,
    folder: /^(module( path)?|folder)$/i,
    preconditions: /^pre-?conditions?$/i,
    description: /^description$/i,
    steps: /^(test )?steps? description$/i,
    expected: /^((test )?steps? )?expected results?$/i,
    stepOrder: /^(test )?step ?(order|#)$/i,
    automationId: /^automation content$/i,
    requirements: /^requirement ?ids?$/i,
  },
  testrail: {
    sourceId: /^id$/i,
    folder: /^section( hierarchy)?$/i,
    steps: /^steps( \(step\))?$/i,
    expected: /^(steps \(expected result\)|expected result)$/i,
    requirements: /^references$/i,
  },
  zephyr: {
    sourceId: /^key$/i,
    title: /^name$/i,
    folder: /^folder$/i,
    description: /^objective$/i,
    steps: /^test script \(step-by-step\) - step$/i,
    testData: /^test script \(step-by-step\) - test data$/i,
    expected: /^test script \(step-by-step\) - expected result$/i,
    requirements: /^coverage \(issues\)$/i,
  },
  xray: {
    sourceId: /^(issue ?key|test ?key|issue ?id)$/i,
    title: /^summary$/i,
    folder: /^test repository path$/i,
    steps: /^action$/i,
    testData: /^data$/i,
    expected: /^expected result$/i,
    requirements: /^(requirements?|covers?)$/i,
  },
  other: {},
};

/** Recognize a tool's export from its column names. */
export function detectSource(header: string[]): ImportSource {
  const h = header.map((x) => x.trim().toLowerCase());
  if (h.some((x) => /^(test )?steps? description$/.test(x)) || (h.includes("module") && h.includes("name"))) return "qtest";
  if (h.some((x) => x.startsWith("test script (step-by-step)"))) return "zephyr";
  if (h.includes("test repository path") || (h.includes("action") && h.includes("summary"))) return "xray";
  if (h.some((x) => /^(steps \((step|expected result)\)|section hierarchy)$/.test(x))) return "testrail";
  return "other";
}

/** Steps are numbered by row order, so a "Step #" column is recognized but not needed. */
export function guessMapping(header: string[], source: ImportSource = "other"): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const claim = (field: ImportField, re: RegExp | undefined) => {
    if (!re || mapping[field] !== undefined) return;
    const idx = header.findIndex((h, i) => !used.has(i) && re.test(h.trim()));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  };
  for (const field of IMPORT_FIELDS) claim(field, SOURCE_HEADERS[source][field]);
  for (const field of IMPORT_FIELDS) claim(field, HEADER_GUESSES[field]);
  return mapping;
}

const HTML = /<\/?(p|br|div|span|ul|ol|li|b|strong|i|em|u|table|tr|td|th|h\d|a|font|pre|code)\b[^>]*>/i;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

const decodeEntities = (text: string) =>
  text.replace(/&(#\d+|#39|\w+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m));

/** Rich-text cells (qTest and others export HTML) become plain text with line breaks. */
export function htmlToText(cell: string): string {
  // Some exports escape plain cells too ("Hub &gt; Spaces"), with no tags around them.
  if (!HTML.test(cell)) return decodeEntities(cell);
  return cell
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|tr|h\d|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#39|\w+);/g, decodeEntities)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// qTest's CSV export drops the line breaks inside rich-text cells, so
// "Enter a SpaceA user can enter a Space." was two lines in qTest. Put them
// back where one word or sentence runs straight into the next. Product names
// written in camel case are left alone.
const CAMEL_WORDS =
  /\b(AppStore|YouTube|GitHub|GitLab|JavaScript|TypeScript|PlayCanvas|PlayStation|PowerPoint|LinkedIn|WordPress|OpenAI|ChatGPT|DevTools|FaceTime|SketchUp|WebGL|WebGPU|WebXR|LoDs?|iPhone|iPad|iOS|macOS|McDonald)\b/g;

export function restoreLineBreaks(text: string): string {
  if (!text || text.includes("\n")) return text;
  const kept: string[] = [];
  return text
    .replace(CAMEL_WORDS, (m) => `\u0000${kept.push(m) - 1}\u0001`)
    .replace(/([.!?:)’”])(?=[A-Z])/g, "$1\n")
    .replace(/([a-z])(?=[A-Z][a-z])/g, "$1\n")
    .replace(/([a-z])(?=[AI] )/g, "$1\n")
    .replace(/([a-z]{2})(?=[A-Z]{2,})/g, "$1\n")
    .replace(/([A-Z]{2,})(?=[A-Z][a-z]+)/g, "$1\n")
    .replace(/\u0000(\d+)\u0001/g, (_, i: string) => kept[Number(i)]);
}

/** qTest prefixes module names with their ID ("MD-12 Checkout"); the folder is just "Checkout". */
const MODULE_ID = /^MD-\d+\s+/i;

/** A plain step, or a block of steps several cases share (qTest's called test cases). */
export type ImportedItem = { kind: "step"; action: string; expected: string } | { kind: "shared"; key: string };
export type ImportedShared = { key: string; name: string; steps: PlainStep[] };

export type ImportedCase = {
  row: number; // 1-based spreadsheet row of the case's first line, header = row 1
  title: string;
  folderPath: string[];
  priority: Priority;
  tags: string[];
  /** Jira story keys from the Requirements, Jira or Story column. */
  stories: string[];
  preconditions: string;
  /** Every step in order, shared ones expanded. */
  steps: PlainStep[];
  /** What the case is saved as: its own steps plus references to shared blocks. */
  items: ImportedItem[];
  type: CaseType;
  automationId: string | null;
  sourceId: string;
};

/**
 * Something in the file to check before importing (ver_107: plain words, and which case and
 * step it's about so the preview can open it). `row` is the spreadsheet row, header = row 1;
 * `lead` is the case it's about, shown in bold; `step` is the step's place among the case's
 * steps (from 0), labeled `chip` in the preview.
 */
export type ImportWarning = { row: number; text: string; lead?: string; caseRow?: number; step?: number; chip?: string };
export type ImportResult = { cases: ImportedCase[]; shared: ImportedShared[]; warnings: ImportWarning[] };
export type ImportOptions = {
  restoreBreaks?: boolean;
  /** Folder names with a " / " inside them that stay one folder (see spacedSlashNames). */
  keepWhole?: string[];
};

const NUMBERED = /^\s*(?:step\s*)?\d+\s*[.):-]\s*/i;

/** Split a cell into separate step texts. */
export function splitStepCell(cell: string): string[] {
  const lines = cell.replace(/\r\n?/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.some((l) => NUMBERED.test(l))) {
    // Numbered list: a line without a number continues the step above it.
    const out: string[] = [];
    for (const line of nonEmpty) {
      if (NUMBERED.test(line) || out.length === 0) out.push(line.replace(NUMBERED, "").trim());
      else out[out.length - 1] += "\n" + line.trim();
    }
    return out;
  }
  return nonEmpty.map((l) => l.trim());
}

/** Pair step and expected texts; extra expected lines go on the last step. */
export function pairSteps(actions: string[], expected: string[]): PlainStep[] {
  if (actions.length === 0) return expected.length ? [{ action: "", expected: expected.join("\n") }] : [];
  const steps = actions.map((action, i) => ({ action, expected: expected[i] ?? "" }));
  if (expected.length > actions.length) {
    const last = steps[steps.length - 1];
    last.expected = [last.expected, ...expected.slice(actions.length)].filter(Boolean).join("\n");
  }
  return steps;
}

export function parsePriority(raw: string): Priority | null {
  const v = raw.trim().toLowerCase();
  if (!v || /^(not prioriti[sz]ed|none|unprioriti[sz]ed|—|-)$/.test(v)) return "MEDIUM";
  if (/^(critical|blocker|highest|urgent|p0|0|1 ?- ?critical)$/.test(v)) return "CRITICAL";
  if (/^(high|major|p1|1|2 ?- ?high)$/.test(v)) return "HIGH";
  if (/^(medium|normal|p2|2|3 ?- ?medium)$/.test(v)) return "MEDIUM";
  if (/^(low|minor|lowest|trivial|p3|p4|3|4|4 ?- ?low)$/.test(v)) return "LOW";
  return null;
}

const onlyKeys = (t: string) => !t.replace(/\b[A-Za-z][A-Za-z0-9]{1,9}-\d+\b/g, "").trim();

/** "PRJ-12, prj-13 PRJ-14" → ["PRJ-12", "PRJ-13", "PRJ-14"]. */
export function storyKeysOf(raw: string): string[] {
  return [...new Set([...raw.matchAll(/\b([A-Za-z][A-Za-z0-9]{1,9}-\d+)\b/g)].map((m) => m[1].toUpperCase()))];
}

export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))];
}

/** A name kept whole: folder names can't hold a slash, so it becomes a dash. */
export const wholeName = (name: string) => name.replace(/\s+\/\s+/g, " - ");

export function parseFolderPath(raw: string, keepWhole: string[] = []): string[] {
  for (const name of keepWhole) raw = raw.split(name).join(wholeName(name));
  return raw
    .split(/\s*(?:\/|>|\\)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const RICH_FIELDS = new Set<ImportField>(["steps", "expected", "description", "preconditions"]);

export function rowsToCases(rows: string[][], mapping: ColumnMapping, source: ImportSource = "other", options: ImportOptions = {}): ImportResult {
  const warnings: ImportWarning[] = [];
  const cases: ImportedCase[] = [];
  // Step order ("1.1", "2.3") of every step, per case, for grouping afterwards.
  const orders: string[][] = [];
  if (mapping.title === undefined) return { cases, shared: [], warnings: [{ row: 1, text: "Choose which column holds the case title." }] };

  const cell = (row: string[], field: ImportField) => {
    const idx = mapping[field];
    if (idx === undefined) return "";
    const text = htmlToText((row[idx] ?? "").trim());
    return options.restoreBreaks && RICH_FIELDS.has(field) ? restoreLineBreaks(text) : text;
  };
  // These tools always export one row per step, so a multi-line cell is one step.
  const oneStepPerRow = source === "qtest" || source === "zephyr" || source === "xray";
  const split = (text: string) => (oneStepPerRow ? (text ? [text] : []) : splitStepCell(text));
  const withData = (steps: PlainStep[], data: string[]) =>
    steps.map((st, i) => (data[i] ? { ...st, action: [st.action, `Test data: ${data[i]}`].filter(Boolean).join("\n") } : st));

  const keyless = { title: rows[0][mapping.title]?.trim() || "Title", id: (mapping.sourceId !== undefined && rows[0][mapping.sourceId]?.trim()) || "ID" };
  // rows[0] is the header.
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowNumber = r + 1;
    if (row.every((c) => c.trim() === "")) continue;

    const steps = withData(pairSteps(split(cell(row, "steps")), split(cell(row, "expected"))), split(cell(row, "testData")));
    const title = cell(row, "title");
    const sourceId = cell(row, "sourceId");
    const prevCase = cases[cases.length - 1];
    const order = cell(row, "stepOrder");
    const addTo = (c: ImportedCase) => {
      c.steps.push(...steps);
      orders[cases.indexOf(c)].push(...steps.map(() => order));
    };

    // qTest-style: every step row repeats the case's ID (and often its name).
    if (sourceId && prevCase?.sourceId === sourceId) {
      addTo(prevCase);
      continue;
    }
    // In a file with case IDs, a row without one is a step of the case above,
    // even when someone left a note like "UPDATE" in its name cell.
    if (!sourceId && title && prevCase?.sourceId && mapping.sourceId !== undefined) {
      const said = `"${title.slice(0, 60)}" in the ${keyless.title} column`;
      warnings.push(
        steps.length
          ? {
              row: rowNumber,
              lead: `${prevCase.sourceId} ${prevCase.title}`.slice(0, 120),
              text: `got ${steps.length === 1 ? "an extra step" : `${steps.length} extra steps`} from a row with no ${keyless.id}. That row (row ${rowNumber} in your file) had ${said}, so it was treated as ${steps.length === 1 ? "a step" : "steps"}, not a new case.`,
              caseRow: prevCase.row,
              step: prevCase.steps.length,
              chip: `From row ${rowNumber}, no ${keyless.id}`,
            }
          : { row: rowNumber, text: `Row ${rowNumber} in your file had ${said} but no ${keyless.id} and no steps, so it was left out.` },
      );
      addTo(prevCase);
      continue;
    }

    if (!title) {
      const prev = cases[cases.length - 1];
      if (prev && steps.length) {
        addTo(prev);
      } else if (steps.length) {
        warnings.push({ row: rowNumber, text: `Row ${rowNumber} in your file has steps but no case above it, so it was left out.` });
      } else {
        warnings.push({ row: rowNumber, text: `Row ${rowNumber} in your file has no title, so it was left out.` });
      }
      continue;
    }

    const rawPriority = cell(row, "priority");
    let priority = parsePriority(rawPriority);
    if (!priority) {
      warnings.push({ row: rowNumber, lead: `${sourceId ? `${sourceId} ` : ""}${title}`.slice(0, 120), text: `has the priority "${rawPriority}" in your file, which Flaw Patrol doesn't know, so it was set to Medium.`, caseRow: rowNumber });
      priority = "MEDIUM";
    }

    const automationId = cell(row, "automationId") || null;
    const typeText = cell(row, "type");
    const rawType = typeText.toLowerCase();
    const type: CaseType = /auto/.test(rawType) || (!rawType && automationId) ? "AUTOMATED" : "MANUAL";
    // TestRail's Type (Functional, Negative…) is more than Manual or Automated: keep it as a tag (ver_91).
    const typeTags = typeText && !/^(manual|auto(mated|mation)?)$/i.test(typeText.trim()) ? [`type: ${typeText.trim()}`] : [];

    const description = cell(row, "description");
    const preconditions = cell(row, "preconditions");
    let folderPath = parseFolderPath(cell(row, "folder"), options.keepWhole);
    if (source === "qtest") folderPath = folderPath.map((f) => f.replace(MODULE_ID, "")).filter(Boolean);

    cases.push({
      row: rowNumber,
      title: title.slice(0, 500),
      folderPath,
      priority,
      // Key-shaped values become Jira story links; anything else stays a tag, as before.
      tags: [...new Set([...parseTags(cell(row, "tags")), ...typeTags, ...parseTags(cell(row, "requirements")).filter((t) => !onlyKeys(t))])],
      stories: storyKeysOf(cell(row, "requirements")),
      preconditions: description && preconditions ? `${description}\n\nPreconditions:\n${preconditions}` : description || preconditions,
      steps,
      items: [],
      type,
      automationId,
      sourceId,
    });
    orders.push(steps.map(() => order));
  }
  return { cases, shared: groupSteps(cases, orders), warnings };
}

/**
 * qTest numbers the steps of a called test case 2.1, 2.2… under the step that
 * calls it. A block that shows up in more than one case becomes a shared step,
 * so it's kept once and shows with the same numbers here. Blocks only one case
 * uses stay as that case's own steps.
 */
function groupSteps(cases: ImportedCase[], orders: string[][]): ImportedShared[] {
  const blocksOf = cases.map((c, ci) => {
    const blocks: { group: string | null; steps: PlainStep[] }[] = [];
    c.steps.forEach((step, i) => {
      const m = orders[ci][i]?.match(/^(\d+)\.\d/);
      const group = m ? m[1] : null;
      const last = blocks[blocks.length - 1];
      if (group !== null && last?.group === group) last.steps.push(step);
      else blocks.push({ group, steps: [step] });
    });
    return blocks;
  });

  const usedBy = new Map<string, Set<number>>();
  blocksOf.forEach((blocks, ci) =>
    blocks.forEach((b) => {
      if (b.group === null) return;
      const sig = JSON.stringify(b.steps);
      usedBy.set(sig, (usedBy.get(sig) ?? new Set()).add(ci));
    }),
  );

  const shared = new Map<string, ImportedShared>();
  const names = new Set<string>();
  blocksOf.forEach((blocks, ci) => {
    cases[ci].items = blocks.flatMap((b): ImportedItem[] => {
      const sig = JSON.stringify(b.steps);
      if (b.group === null || (usedBy.get(sig)?.size ?? 0) < 2) return b.steps.map((s) => ({ kind: "step", ...s }));
      let def = shared.get(sig);
      if (!def) {
        let name = blockName(b.steps);
        for (let n = 2; names.has(name.toLowerCase()); n++) name = `${blockName(b.steps)} (${n})`;
        names.add(name.toLowerCase());
        def = { key: `s${shared.size + 1}`, name, steps: b.steps };
        shared.set(sig, def);
      }
      return [{ kind: "shared", key: def.key }];
    });
  });
  return [...shared.values()];
}

/** A block usually opens with a heading row like "SEARCH BAR SHARED STEPS"; name it after that. */
function blockName(steps: PlainStep[]): string {
  const first = steps[0].action.split("\n")[0].replace(/[\s=:]+$/, "").trim();
  return (first || "Shared steps").slice(0, 120);
}

/**
 * Folder names that hold a " / " in a file that otherwise splits folders with a
 * bare "/": "2026 Cases/Shared / Unique Cases" is most likely two levels, the
 * second named "Shared / Unique Cases". Import splits them unless kept whole.
 */
export function spacedSlashNames(rows: string[][], mapping: ColumnMapping): string[] {
  if (mapping.folder === undefined) return [];
  const found = new Set<string>();
  for (const row of rows.slice(1)) {
    const raw = htmlToText((row[mapping.folder] ?? "").trim());
    if (!/\S\/\S/.test(raw) || !/\s\/\s/.test(raw)) continue;
    for (const part of raw.split(/(?<=\S)\/(?=\S)/)) if (/\s\/\s/.test(part)) found.add(part.trim());
  }
  return [...found];
}

/** The folders an import will make, as a tree with how many cases land in each. */
export type FolderPreview = { name: string; count: number; children: FolderPreview[] };
export function folderPreview(cases: ImportedCase[]): FolderPreview[] {
  const root: FolderPreview[] = [];
  for (const c of cases) {
    let level = root;
    c.folderPath.forEach((name, i) => {
      let node = level.find((n) => n.name.toLowerCase() === name.toLowerCase());
      if (!node) level.push((node = { name, count: 0, children: [] }));
      if (i === c.folderPath.length - 1) node.count++;
      level = node.children;
    });
  }
  return root;
}

/** A case's steps numbered as they'll show after import: 1, 2, then 3.1, 3.2 for a shared block. */
export function numberedSteps(c: ImportedCase, shared: ImportedShared[]): (PlainStep & { number: string; sharedName?: string })[] {
  return c.items.flatMap((item, i) => {
    const n = String(i + 1);
    if (item.kind === "step") return [{ number: n, action: item.action, expected: item.expected }];
    const def = shared.find((s) => s.key === item.key)!;
    return def.steps.map((s, j) => ({ ...s, number: def.steps.length === 1 ? n : `${n}.${j + 1}`, sharedName: def.name }));
  });
}

export const MAX_IMPORT = 5000;
