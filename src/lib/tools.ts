// Tools: each umbrella picks which tools it uses. A tool that's off is gone from the
// umbrella's menu, Overview, Reports, Settings and Ctrl+K, but nothing in it is deleted: turning it
// back on brings everything back. Saved on ProjectGroup.tools as { off: [...] }, so umbrellas made
// before ver_128 (and any tool added later) start on. Overview, Bugs, Reports, Settings and Members
// are always there.

export const TOOL_IDS = ["cases", "runs", "charters", "bashes", "stories", "risk", "auto", "quest", "glossary"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export type Tool = {
  id: ToolId;
  name: string;
  /** What's in it, in plain words. */
  what: string;
  /** Tools it can't work without; they turn on with it, and it turns off with them. */
  needs: ToolId[];
  /** Why it needs them, after "because". */
  why?: string;
  /** Works alone, but gets smarter with these. */
  better?: string;
  /** "Test runs are off" vs "Glossary is off". */
  plural?: boolean;
};

export const TOOLS: Tool[] = [
  { id: "cases", name: "Test cases", what: "Case library, Test suites, Shared steps", needs: [], plural: true },
  { id: "runs", name: "Test runs", what: "Test runs, Test cycles, Release status, Regression flag, Run kinds and Run fields", needs: ["cases"], why: "runs run test cases", plural: true },
  {
    id: "charters",
    name: "Charters",
    what: "Charters, Personas and exploring sessions",
    needs: ["runs"],
    why: "exploring sessions are saved as runs",
    better: "Requirements (charters can test a requirement)",
    plural: true,
  },
  { id: "bashes", name: "Bug bashes", what: "Start a bug bash, the live board, wrap-up and bash reports", needs: [], better: "Risk board and Case library (they suggest areas)", plural: true },
  { id: "stories", name: "Requirements", what: "Jira stories and Epics, and what tests them", needs: [], better: "Test cases (shows which are covered)", plural: true },
  {
    id: "risk",
    name: "Risk board",
    what: "Which requirements in a release are most likely to break",
    needs: ["stories"],
    why: "its cards are the release's requirements",
    better: "Test cases and Test runs (Plan this release)",
  },
  { id: "auto", name: "Automation", what: "CI uploads, GitHub test health, screenshots, videos and replays", needs: ["runs"], why: "results come in as runs", better: "GitHub connection" },
  { id: "quest", name: "Quest map", what: "The mini game on test cycles, and crowns", needs: ["runs"], why: "quests come from running cases" },
  { id: "glossary", name: "Glossary", what: "The team's words and what they mean", needs: [] },
];

export const toolById = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, Tool>;
const isTool = (s: unknown): s is ToolId => typeof s === "string" && (TOOL_IDS as readonly string[]).includes(s);

export type PresetId = "all" | "bash" | "cases" | "own";
export const PRESETS: { id: PresetId; name: string; text: string; tools: ToolId[] | null }[] = [
  { id: "all", name: "Everything", text: "Test cases, runs, bug bashes, risk board and the rest", tools: [...TOOL_IDS] },
  { id: "bash", name: "Bug bashes and risk", text: "Explore together and see what's most likely to break. No test cases.", tools: ["bashes", "stories", "risk"] },
  { id: "cases", name: "Test cases and runs", text: "Write cases, run them, track releases", tools: ["cases", "runs", "charters", "stories", "glossary"] },
  { id: "own", name: "Pick my own", text: "Tick just the tools you want", tools: null },
];

/** The tools that are on, from ProjectGroup.tools. Anything unreadable means every tool is on. */
export function toolsOn(v: unknown): ToolId[] {
  const off = v && typeof v === "object" && Array.isArray((v as { off?: unknown }).off) ? (v as { off: unknown[] }).off.filter(isTool) : [];
  return fixNeeds(TOOL_IDS.filter((id) => !off.includes(id)));
}

/** What to save for these tools being on. */
export function toolsValue(on: readonly ToolId[]) {
  const fixed = fixNeeds(on);
  return { off: TOOL_IDS.filter((id) => !fixed.includes(id)) };
}

/** Drops any tool whose needs aren't on, so a saved list can never leave one half working. */
export function fixNeeds(on: readonly ToolId[]): ToolId[] {
  const set = new Set(on.filter(isTool));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...set])
      if (toolById[id].needs.some((n) => !set.has(n))) {
        set.delete(id);
        changed = true;
      }
  }
  return TOOL_IDS.filter((id) => set.has(id));
}

/** Turn one on: what it needs comes too. Returns the new list and which others came on. */
export function turnOn(on: readonly ToolId[], id: ToolId) {
  const set = new Set(on);
  const add = (t: ToolId) => {
    set.add(t);
    for (const n of toolById[t].needs) if (!set.has(n)) add(n);
  };
  add(id);
  const next = TOOL_IDS.filter((t) => set.has(t));
  return { on: next, also: next.filter((t) => t !== id && !on.includes(t)) };
}

/** Turn one off: whatever needs it goes too. Returns the new list and which others went off. */
export function turnOff(on: readonly ToolId[], id: ToolId) {
  const set = new Set(on);
  const drop = (t: ToolId) => {
    set.delete(t);
    for (const d of TOOLS) if (set.has(d.id) && d.needs.includes(t)) drop(d.id);
  };
  drop(id);
  const next = TOOL_IDS.filter((t) => set.has(t));
  return { on: next, also: on.filter((t) => t !== id && !next.includes(t)) };
}

export const everything = (on: readonly ToolId[]) => TOOL_IDS.every((id) => on.includes(id));

/** "Bug bashes · Risk board" for the Umbrellas page; "" when every tool is on, as before. */
export function toolsLine(on: readonly ToolId[]) {
  if (everything(on)) return "";
  if (!on.length) return "Bugs and reports only";
  return on.map((id) => toolById[id].name).join(" · ");
}

/** The preset these tools match, or "own". */
export function presetOf(on: readonly ToolId[]): PresetId {
  const key = [...on].sort().join(",");
  return PRESETS.find((p) => p.tools && [...p.tools].sort().join(",") === key)?.id ?? "own";
}

/** "Test runs are off" / "Risk board is off". */
export const isOff = (t: Tool) => `${t.name} ${t.plural ? "are" : "is"} off`;

/**
 * Which tool a page inside an umbrella belongs to, or null for pages every umbrella has.
 * `hub` is the umbrella's library project key, `g` its id, and `cycles` the keys of its test cycles.
 */
export function toolOfPath(path: string, at: { g: string; hub: string; cycles: string[] }): ToolId | null {
  const under = (p: string) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`);
  const g = `/g/${at.g}`;
  const h = `/p/${at.hub}`;
  if (under(`${g}/runs`) || under(`${g}/rc`) || under(`${g}/projects`)) return "runs";
  if (under(`${g}/status/github`)) return "auto";
  if (under(`${g}/stories`)) return "stories";
  for (const [p, t] of [
    ["cases", "cases"],
    ["import", "cases"],
    ["suites", "cases"],
    ["shared-steps", "cases"],
    ["charters", "charters"],
    ["personas", "charters"],
    ["stories", "stories"],
    ["risk", "risk"],
    ["bashes", "bashes"],
    ["glossary", "glossary"],
    ["runs", "runs"],
    ["replay", "auto"],
    ["quests", "quest"],
  ] as const)
    if (under(`${h}/${p}`)) return t;
  // A test cycle's own pages are part of Test runs, its Quest map part of Quest map.
  for (const key of at.cycles) {
    const c = `/p/${key}`;
    if (under(`${c}/quests`)) return "quest";
    if (under(`${c}/bashes`)) return "bashes";
    if (under(`${c}/settings`) || under(`${c}/bugs`) || under(`${c}/defects`)) return null;
    if (under(c)) return "runs";
  }
  return null;
}

/** The umbrella's Reports tabs: one per tool that's on, Custom reports always. */
export function reportTabs(at: { g: string; hub: string; tools: readonly ToolId[] }, current: "runs" | "rc" | "stories" | "custom", release?: string) {
  const g = `/g/${at.g}`;
  const on = (t: ToolId) => at.tools.includes(t);
  return [
    ...(on("runs") ? [{ label: "Run reports", href: `${g}/reports`, current: current === "runs" }] : []),
    ...(on("runs") ? [{ label: "Release status", href: `${g}/rc${release ? `?release=${encodeURIComponent(release)}` : ""}`, current: current === "rc" }] : []),
    ...(on("stories") ? [{ label: "Requirements", href: `${g}/stories`, current: current === "stories" }] : []),
    ...(on("bashes") ? [{ label: "Bug bashes", href: `/p/${at.hub}/bashes`, current: false }] : []),
    { label: "Custom reports", href: `${g}/reports/custom`, current: current === "custom" },
  ];
}

/** Where the menu's Reports goes: Run reports, or the first tab that's left when Test runs is off. */
export function reportsHome(at: { g: string; tools: readonly ToolId[] }) {
  return at.tools.includes("runs") ? `/g/${at.g}/reports` : at.tools.includes("stories") ? `/g/${at.g}/stories` : `/g/${at.g}/reports/custom`;
}
