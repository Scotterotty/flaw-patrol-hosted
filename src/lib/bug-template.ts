// The team bug template (the OB-5292 layout): titles like
// "[UNREAL] - Assets Panel - Brief summary", a Reproduction History table, and
// the OKO Jira fields. Pure, so the dialog, the server and the tests share it.

/**
 * A project's template switch and the defaults it fills in on every bug. With
 * `imported` set, bugs follow a layout copied from an example Jira bug; without
 * it, `on` means the detailed layout with a Reproduction History table.
 */
export type TemplateSettings = {
  on: boolean;
  clientTag: string;
  team: string;
  clients: string[];
  olyEnv: string[];
  imported: ImportedTemplate | null;
  /**
   * Jira Priority on every new bug, whatever the layout: null (never picked) means
   * "Not Prioritized" when Jira has it, "" means leave it to Jira, else a priority's name.
   */
  priority: string | null;
};

export const TEMPLATE_OFF: TemplateSettings = { on: false, clientTag: "", team: "", clients: [], olyEnv: [], imported: null, priority: null };

/** The priority new bugs get when nobody has picked one. */
export const DEFAULT_PRIORITY = "Not Prioritized";

/** The Jira priority for a setting, out of the priorities Jira lists; null leaves it to Jira. */
export function pickPriority(setting: string | null, options: string[]): string | null {
  const find = (name: string) => options.find((o) => o.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
  if (setting === "") return null;
  return find(setting ?? DEFAULT_PRIORITY);
}

/** Where a description section's text comes from on each new bug. */
export const SECTION_SOURCES = {
  steps: "Steps from the test case",
  expected: "Expected result of the failed step",
  actual: "What the tester typed",
  env: "Run's release, build and environment",
  tester: "Tester fills in",
  empty: "Leave out",
} as const;
export type SectionSource = keyof typeof SECTION_SOURCES;

/** Where a Jira field's value comes from on each new bug. */
export const FIELD_SOURCES = { tester: "Tester picks", default: "Default", release: "Run's release", empty: "Leave empty" } as const;
export type FieldSource = keyof typeof FIELD_SOURCES;

/** A bug layout copied from one example Jira bug: its title shape, description headings and the fields it used. */
export type ImportedTemplate = {
  /** The example bug's key. */
  from: string;
  title: { tag: boolean; feature: boolean };
  sections: { heading: string; source: SectionSource }[];
  fields: { id: string; name: string; required: boolean; source: FieldSource; value: string[] }[];
};

/** Which layout bugs use: the plain one, an imported one, or the detailed Reproduction History one. */
export function templateKind(t: TemplateSettings): "plain" | "imported" | "detailed" {
  return !t.on ? "plain" : t.imported ? "imported" : "detailed";
}

function parseImported(v: unknown): ImportedTemplate | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const from = str(o.from, 40);
  if (!from) return null;
  const t = (o.title ?? {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is Record<string, unknown> => !!y && typeof y === "object").slice(0, 40) : []);
  return {
    from,
    title: { tag: t.tag === true, feature: t.feature === true },
    sections: list(o.sections)
      .map((x) => ({ heading: str(x.heading, 120), source: (x.source as string) in SECTION_SOURCES ? (x.source as SectionSource) : "tester" }))
      .filter((x) => x.heading),
    fields: list(o.fields)
      .map((x) => ({ id: str(x.id, 60), name: str(x.name, 120), required: x.required === true, source: (x.source as string) in FIELD_SOURCES ? (x.source as FieldSource) : "tester", value: strs(x.value) }))
      .filter((x) => x.id && x.name),
  };
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 100)).filter(Boolean).slice(0, 30) : []);

export function parseTemplateSettings(v: unknown): TemplateSettings {
  if (!v || typeof v !== "object") return TEMPLATE_OFF;
  const o = v as Record<string, unknown>;
  return {
    on: o.on === true,
    clientTag: str(o.clientTag, 40),
    team: str(o.team, 100),
    clients: strs(o.clients),
    olyEnv: strs(o.olyEnv),
    imported: parseImported(o.imported),
    priority: typeof o.priority === "string" ? str(o.priority, 100) : null,
  };
}

/**
 * What a project's bugs use when it points at a company template: the shared layout,
 * with this project's own defaults (client tag, team, clients) wherever the shared one has none.
 */
export function effectiveTemplate(own: unknown, shared: unknown | null | undefined): TemplateSettings {
  const mine = parseTemplateSettings(own);
  if (!shared) return mine;
  const t = parseTemplateSettings(shared);
  return { ...t, on: true, priority: mine.priority, clientTag: t.clientTag || mine.clientTag, team: t.team || mine.team, clients: t.clients.length ? t.clients : mine.clients, olyEnv: t.olyEnv.length ? t.olyEnv : mine.olyEnv };
}

/** Whether an email may use a template shared with these endings ("magnopus.com"). */
export const emailMatches = (email: string | null | undefined, domains: string[]) => !!email && domains.some((d) => email.toLowerCase().endsWith(`@${d.toLowerCase().replace(/^@/, "")}`));

/**
 * The title shape of an example bug: "[MOBILE] - Login - Password hidden" has a
 * tag and a feature before the summary; "Login - Password hidden" only a feature.
 */
export function titlePattern(summary: string) {
  const m = /^\s*\[([^\]]+)\]\s*-?\s*(.*)$/.exec(summary);
  const rest = (m ? m[2] : summary).trim();
  const parts = rest.split(/\s+-\s+/);
  const feature = parts.length > 1 ? parts[0].trim() : "";
  return { tag: !!m, feature: !!feature, example: { tag: m?.[1].trim() ?? "", feature, summary: parts.length > 1 ? parts.slice(1).join(" - ") : rest } };
}

/** A title in the imported shape; blank tag or feature are left out. */
export function importedTitle(p: { tag: boolean; feature: boolean }, b: { tag: string; feature: string; summary: string }) {
  return templateTitle({ clientTag: p.tag ? b.tag : "", feature: p.feature ? b.feature : "", brief: b.summary });
}

type Adf = { type?: string; text?: string; content?: Adf[]; marks?: { type?: string }[]; attrs?: Record<string, unknown> };

const plainOf = (n: Adf): string => (n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(plainOf).join(""));

/**
 * The section headings of an example bug's description: Jira headings, and short
 * paragraphs written all in bold ("Steps to Reproduce:"). Only the words of the
 * headings are kept; the example's own text stays in Jira.
 */
export function adfHeadings(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (nodes: Adf[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "heading") out.push(plainOf(n));
      else if (n.type === "paragraph") {
        const parts = (n.content ?? []).filter((c) => c.type !== "hardBreak" && !(c.type === "text" && !c.text?.trim()));
        const bold = parts.length > 0 && parts.every((c) => c.type === "text" && c.marks?.some((m) => m.type === "strong"));
        if (bold) out.push(plainOf(n));
      } else if (n.type === "expand" || n.type === "panel" || n.type === "layoutSection" || n.type === "layoutColumn") walk(n.content);
    }
  };
  walk((doc as Adf | null)?.content);
  const seen = new Set<string>();
  return out
    .map((h) => h.replace(/\s+/g, " ").replace(/[:：]\s*$/, "").trim())
    .filter((h) => h && h.length <= 80 && !seen.has(h.toLowerCase()) && !!seen.add(h.toLowerCase()))
    .slice(0, 20);
}

/** A first guess at where a section's text comes from, from its heading. */
export function guessSection(heading: string): SectionSource {
  const h = heading.toLowerCase();
  if (/step|reproduc|how to/.test(h)) return "steps";
  if (/expect/.test(h)) return "expected";
  if (/actual|observed|what happen|result|issue|problem|description|summary/.test(h)) return "actual";
  if (/environment|build|version|platform|device|client|release/.test(h)) return "env";
  return "tester";
}

/** A first guess at where a Jira field's value comes from. */
export function guessField(name: string, hasValue: boolean): FieldSource {
  const n = name.toLowerCase();
  if (/severity|repro|frequency/.test(n)) return "tester";
  if (/version|build|release/.test(n)) return "release";
  if (/label/.test(n)) return "empty";
  return hasValue ? "default" : "tester";
}

/** An example bug's field value as plain strings, or null when it's a kind Flaw Patrol can't fill. */
export function exampleValue(v: unknown): string[] | null {
  if (v === null || v === undefined || v === "") return [];
  if (typeof v === "string") return [v.slice(0, 500)];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) {
    const out = v.map((x) => exampleValue(x)).filter((x): x is string[] => x !== null);
    return out.length === v.length ? out.flat() : null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.type === "doc") return [plainOf(o as Adf).trim().slice(0, 2000)].filter(Boolean);
    const named = o.value ?? o.name;
    if (typeof named === "string") return [named];
  }
  return null;
}

/** The Jira fields the template fills, by the names the team's Jira gives them. */
export const FIELD = {
  clients: "Client/SKUs",
  team: "Team",
  reproRate: "Repro Rate",
  build: "Build #",
  olyEnv: "Oly Environment",
  reproSteps: "Repro Steps",
  spaceLink: "OKO Space Link",
  impact: "Bug Impact",
  workaround: "Bug Workaround",
  lastReproduced: "Last Reproduced",
  toBeAutomated: "To Be Automated?",
  statusUpdate: "Status update",
} as const;

/** Fields OB-5292 always has the same way. Filled when Jira has them, never written into the description. */
export const FIXED_FIELDS: Partial<Record<keyof typeof FIELD, string>> = { toBeAutomated: "Maybe", statusUpdate: "Not Started" };

/** Template fields left out quietly when Jira doesn't have them. */
export const QUIET_FIELDS = new Set<string>([FIELD.lastReproduced, FIELD.toBeAutomated, FIELD.statusUpdate]);

export type History = { dateTime: string; client: string; csp: string; context: string; user: string; envTenant: string; repros: string };

/** The first version number in a box: "Web 4.21.0" → "4.21.0". Blank when there's none. */
export function versionIn(text: string): string {
  return /\d+(?:\.\d+)+/.exec(text)?.[0] ?? /\d+/.exec(text)?.[0] ?? "";
}

/** Build # from the Client and CSP boxes: "Version 4.21.0 - CSP 7.1.0". Blank when both are. */
export function buildLine(client: string, csp: string): string {
  const v = versionIn(client);
  const c = versionIn(csp);
  return v || c ? `Version ${v || "x"} - CSP ${c || "x"}` : "";
}

/** Jira fields the tester typed in themselves, so the Reproduction History boxes stop filling them. */
export type ByHand = { reproRate: boolean; build: boolean };

/**
 * One Reproduction History box changed. Repro rate copies Repros, and Build # takes the version
 * numbers from Client and CSP (Scott, Nov 10: "to save time"), until they're typed in by hand.
 */
export function withHistory(b: TemplateBug, k: keyof History, v: string, byHand: ByHand): TemplateBug {
  const history = { ...b.history, [k]: v };
  return {
    ...b,
    history,
    ...(k === "repros" && !byHand.reproRate ? { reproRate: v } : {}),
    ...((k === "client" || k === "csp") && !byHand.build ? { build: buildLine(history.client, history.csp) } : {}),
  };
}

/** Everything the tester can edit in the dialog before filing. */
export type TemplateBug = {
  clientTag: string;
  feature: string;
  brief: string;
  observedOn: string;
  clientsNeeded: string;
  what: string;
  slack: string;
  history: History;
  reproSteps: string;
  spaceLink: string;
  impact: string;
  workaround: string;
  reproRate: string;
  build: string;
  clients: string[];
  team: string;
  olyEnv: string[];
};

export function templateTitle(b: Pick<TemplateBug, "clientTag" | "feature" | "brief">) {
  const tag = b.clientTag.trim().replace(/^\[|\]$/g, "");
  return [tag && `[${tag}]`, b.feature.trim(), b.brief.trim()].filter(Boolean).join(" - ").slice(0, 250);
}

/** "[UNREAL] - In Space - UI - Assets Panel" → "UNREAL". */
export function tagOf(caseTitle: string) {
  return /^\s*\[([^\]]+)\]/.exec(caseTitle)?.[1].trim().toUpperCase() ?? "";
}

/** "[UNREAL] - In Space - UI - Assets Panel" → "Assets Panel": the last part of the case name. */
export function featureOf(caseTitle: string) {
  const parts = caseTitle
    .replace(/^\s*\[[^\]]*\]\s*-?\s*/, "")
    .split(/\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1) ?? "";
}

// Longest first, so "Web Mobile" wins over "Web".
const CLIENT_WORDS = ["Web Mobile", "Vision OS", "Unreal", "Unity", "Web", "Android", "iOS", "Mac", "Windows", "VR", "Editor", "Musubi", "CHS", "CSP"];

/** The client named in a project or run name, like "Unreal" in "OKO Unreal RC22". */
export function clientIn(text: string) {
  return CLIENT_WORDS.find((w) => new RegExp(`(^|[^a-z])${w.replace(/ /g, "\\s*")}([^a-z]|$)`, "i").test(text)) ?? "";
}

/** The Jira option matching a word, spelled as Jira has it. */
export function optionLike(options: string[], word: string) {
  return options.find((o) => o.toLowerCase() === word.trim().toLowerCase()) ?? "";
}

export const isDxdiag = (fileName: string) => /dxdiag/i.test(fileName);
export const isMedia = (contentType: string) => /^(image|video)\//.test(contentType);

// A file name that says nothing: a UUID or a long run of hex, as screen recorders and pastes make.
const RANDOM_NAME = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}/i;

const slug = (t: string) =>
  t
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/**
 * Names for the files put on a bug: a random name like "5ee7591c-…_video.mp4"
 * becomes "UNREAL_Assets-Panel_video-1.mp4"; any other name is kept. Numbers
 * count per kind (video, screenshot, log), and no two names come out the same.
 */
export function friendlyNames<T extends { fileName: string; contentType: string }>(files: T[], b: Pick<TemplateBug, "clientTag" | "feature">): T[] {
  const count: Record<string, number> = {};
  const used = new Set<string>();
  const prefix = [slug(b.clientTag), slug(b.feature)].filter(Boolean).join("_") || "bug";
  return files.map((f) => {
    const dot = f.fileName.lastIndexOf(".");
    const ext = dot > 0 ? f.fileName.slice(dot + 1).toLowerCase() : "";
    let name = f.fileName;
    if (RANDOM_NAME.test(dot > 0 ? f.fileName.slice(0, dot) : f.fileName)) {
      const kind = f.contentType.startsWith("video/") ? "video" : f.contentType.startsWith("image/") ? "screenshot" : "log";
      do name = `${prefix}_${kind}-${(count[kind] = (count[kind] ?? 0) + 1)}${ext ? `.${ext}` : ""}`;
      while (used.has(name.toLowerCase()));
    }
    used.add(name.toLowerCase());
    return { ...f, fileName: name };
  });
}

/** Screenshots and videos first, then logs; each keeps its own order. */
export function orderFiles<T extends { contentType: string }>(files: T[]) {
  return { media: files.filter((f) => isMedia(f.contentType)), logs: files.filter((f) => !isMedia(f.contentType)) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026/10/23\n15:42:10" in the tester's own time. */
export function stamp(d = new Date()) {
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}\n${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** What a tester last typed, per client tag, so they type it once. */
export type Profile = Record<string, { context?: string; user?: string; tenant?: string }>;

export function parseProfile(v: unknown): Profile {
  if (!v || typeof v !== "object") return {};
  const out: Profile = {};
  for (const [k, e] of Object.entries(v as Record<string, unknown>).slice(0, 100)) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    out[k] = { context: str(o.context, 500), user: str(o.user, 200), tenant: str(o.tenant, 200) };
  }
  return out;
}

/**
 * What this tester typed last time, for a bug on this client in this environment. Context and tenant are kept
 * per client; User name & ID per client and environment too, since it's a different account on each
 * (Scott, Nov 10: "your OKO user name on that environment and your Swagger ID on that environment").
 */
export function rememberedFor(profile: Profile, clientTag: string, environment: string) {
  const tag = clientTag.trim() || "_";
  const own = profile[tag] ?? {};
  const env = environment.trim() ? profile[`${tag}@${environment.trim().toLowerCase()}`] : undefined;
  return { context: own.context ?? "", user: env?.user ?? own.user ?? "", tenant: env?.tenant ?? own.tenant ?? "" };
}

/** Keep what was typed on this bug for next time: see rememberedFor. */
export function rememberInto(profile: Profile, b: Pick<TemplateBug, "clientTag" | "history">): Profile {
  const tag = b.clientTag.trim() || "_";
  const user = b.history.user.trim();
  const tenant = tenantOf(b.history.envTenant);
  const env = envOf(b.history.envTenant);
  const out: Profile = { ...profile, [tag]: { context: b.history.context.trim(), user, tenant } };
  if (env) out[`${tag}@${env.toLowerCase()}`] = { user, tenant };
  return out;
}

/** "o2QA\nmagnopus-qa" → "o2QA": the environment line. */
export function envOf(envTenant: string) {
  return envTenant.split("\n")[0].trim();
}

/** "o2QA\nmagnopus-qa" → "magnopus-qa": the lines after the environment. */
export function tenantOf(envTenant: string) {
  return envTenant.split("\n").slice(1).join("\n").trim();
}

/** A browser's name and OS from its user agent, for web clients' Context. */
export function browserContext(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const version = (browser === "Edge" ? /Edg\/(\d+)/ : browser === "Chrome" ? /Chrome\/(\d+)/ : browser === "Firefox" ? /Firefox\/(\d+)/ : /Version\/(\d+)/).exec(ua)?.[1];
  const os = /Windows NT 10/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser && `${browser}${version ? ` ${version}` : ""}`, os].filter(Boolean).join("\n");
}
