import "server-only";
import { db } from "./db";
import type { Severity } from "@prisma/client";
import { open } from "./crypto";
import { richText } from "./jira-format";
import { parseSeverity, parseSeverityConfig, scaleOf } from "./severity";
import { foundInLine, parseFoundIn, type FoundInField, type JiraVersion } from "./found-in";
import { jiraConfigFor } from "./umbrella";
import { parseTemplateSettings, pickPriority } from "./bug-template";

// Minimal Jira Cloud REST v3 client using an API token (basic auth).

export type JiraIssue = {
  key: string;
  summary: string;
  status: string;
  category: string;
  url: string;
  severity: Severity | null;
  priority: string;
  type: string;
  parent: string | null;
  points?: number | null;
  /** Found-in version: the names in the picked version field, when that setting is on. */
  foundIn?: string | null;
};

export class JiraError extends Error {
  /** Jira's complaints per field id (or "reporter"), when it refused some fields. */
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** A field on the connected project's create screen, from Jira's create metadata. */
export type MetaField = {
  id: string;
  name: string;
  required: boolean;
  schema: { type?: string; items?: string; custom?: string };
  options: string[];
  /** Only on Jira's Edit screen: filled just after the bug is created, not while creating it. */
  later?: boolean;
};

type RawMeta = { fieldId?: string; key?: string; name: string; required?: boolean; schema?: MetaField["schema"]; allowedValues?: { value?: string; name?: string; disabled?: boolean }[] };

const toMeta = (f: RawMeta, id = f.fieldId ?? f.key ?? ""): MetaField => ({
  id,
  name: f.name,
  required: !!f.required,
  schema: f.schema ?? {},
  options: (f.allowedValues ?? []).filter((o) => !o.disabled).map((o) => o.value ?? o.name ?? "").filter(Boolean),
});

/** A value for a create-screen field, converted to Jira's shape by its type. */
export type FieldValue = string | string[];

/** Jira's own shape for a value, or undefined when this kind of field isn't supported. */
export function jiraValue(f: MetaField, v: FieldValue): unknown {
  const list = (Array.isArray(v) ? v : [v]).map((x) => x.trim()).filter(Boolean);
  const one = list.join(", ");
  if (!list.length) return undefined;
  const { type, items, custom = "" } = f.schema;
  if (type === "array" && items === "option") return list.map((value) => ({ value }));
  if (type === "array" && items === "string") return list.map((x) => x.replace(/\s+/g, "-"));
  if (type === "array" && (items === "component" || items === "version")) return list.map((name) => ({ name }));
  if (type === "version" || type === "component") return { name: list[0] };
  if (type === "option") return { value: list[0] };
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(list[0]) ? list[0] : undefined;
  if (type === "number") return Number.isFinite(Number(one)) ? Number(one) : undefined;
  if (type === "string") return custom.endsWith(":textarea") ? richText(Array.isArray(v) ? v.join("\n") : v) : one.slice(0, 255);
  return undefined;
}

export const UNREADABLE_TOKEN =
  "The saved Jira API token can't be read here. It was saved with a different AUTH_SECRET (from another copy of Flaw Patrol, or an older .env). Paste the API token again in Settings → Jira, and give every copy that shares this database the same AUTH_SECRET.";

export type JiraCreds = {
  siteUrl: string;
  email: string;
  token: string;
  jiraProjectKey: string;
  issueType: string;
  /** Settings → Jira → Severity field. */
  severity?: unknown;
  /** Settings → Jira → Found-in version. */
  foundIn?: unknown;
  /** Settings → Jira → Bug template, for its Jira Priority. */
  bugTemplate?: unknown;
};

export async function jiraFor(projectId: string): Promise<JiraClient | null> {
  // A project in an umbrella uses the umbrella's Jira unless it has its own.
  const cfg = await jiraConfigFor(projectId);
  if (!cfg) return null;
  let token: string;
  try {
    token = open(cfg.tokenEncrypted);
  } catch {
    // Sealed with a different AUTH_SECRET: another copy of Flaw Patrol on this
    // database saved it, or this copy's .env was recreated.
    throw new JiraError(UNREADABLE_TOKEN);
  }
  return new JiraClient({ ...cfg, token });
}

/** JQL for the issues that count as stories: their types, in the story project ("" = the bug project, "*" = anywhere). */
function storyScope(cfg: { project: string; types: string[] }, bugProject: string) {
  const types = (cfg.types.length ? cfg.types : ["Story", "Task"]).map((t) => `"${t.replace(/"/g, "")}"`).join(",");
  const project = cfg.project === "*" ? "" : `project = "${(cfg.project || bugProject).replace(/"/g, "")}" AND `;
  return `${project}issuetype in (${types})`;
}

export function normalizeSite(url: string) {
  return url.trim().replace(/\/+$/, "");
}

type RawIssue = { key: string; fields: { summary?: string; status?: { name?: string; statusCategory?: { key?: string } } } & Record<string, unknown> };

/** self: the token owner, who Jira makes the Reporter anyway. */
export type JiraUser = { accountId: string; displayName: string; self?: boolean };

// Jira accounts found by email, per site, so filing a bug doesn't look the tester up every time.
const usersByEmail = new Map<string, { user: JiraUser | null; at: number }>();
const USER_TTL = 10 * 60_000;

// The token owner per site and login, looked up once.
const owners = new Map<string, Promise<{ accountId: string; displayName: string; email: string }>>();

// The site's own "Severity" field (a custom field, so its id differs per site), looked up once per site.
const severityFields = new Map<string, Promise<string | null>>();
const pointsFields = new Map<string, Promise<string | null>>();

// Create-screen fields per site, project and issue type, kept a few minutes.
const createMetas = new Map<string, { fields: MetaField[]; at: number }>();
// Edit-screen fields per site, project and issue type, read from the newest bug, kept a few minutes.
const editMetas = new Map<string, { fields: MetaField[]; at: number }>();
const META_TTL = 5 * 60_000;

export class JiraClient {
  constructor(readonly creds: JiraCreds) {}

  /**
   * Regression flag: labels to add to the next issue filed (dropped if Jira won't take
   * them), and lines put first in its description, like "Passed in Web RC 21 (build 4790)…".
   */
  labels: string[] = [];
  leadLines: string[] = [];
  /** Blocks put last in the description, like the Sentry errors section. */
  tailBlocks: object[] = [];
  /**
   * Found-in version: the version for the next issue filed. known is false when Jira
   * has no version by that name, so it goes in the description instead of the field.
   */
  foundIn: { field: FoundInField; label: string; value: string; known: boolean } | null = null;

  private withLead(description: object, more: string[] = []) {
    const lead = [...this.leadLines, ...more];
    if (!lead.length && !this.tailBlocks.length) return description;
    const d = description as { type?: string; content?: object[] };
    const lines = lead.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t, marks: [{ type: "strong" }] }] }));
    return { ...d, content: [...lines, ...(d.content ?? []), ...this.tailBlocks] };
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const auth = Buffer.from(`${this.creds.email}:${this.creds.token}`).toString("base64");
    let res: Response;
    try {
      res = await fetch(`${normalizeSite(this.creds.siteUrl)}${path}`, {
        ...init,
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch {
      throw new JiraError("Couldn't reach Jira. Check the site address.");
    }
    if (res.status === 401 || res.status === 403) throw new JiraError("Jira rejected the email or API token, or it lacks permission.");
    if (res.status === 404) throw new JiraError("Not found in Jira.");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { errorMessages?: string[]; errors?: Record<string, string> } | null;
      const msg = [...(body?.errorMessages ?? []), ...Object.values(body?.errors ?? {})].join(" ");
      throw new JiraError(`Jira said: ${msg || res.statusText}`, body?.errors ?? {});
    }
    // Jira answers some writes (like issueLink's 201) with no body at all.
    const text = res.status === 204 ? "" : await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** The team's severity names, from Settings → Jira → Severity field. */
  get scale() {
    return scaleOf(parseSeverityConfig(this.creds.severity));
  }

  /** The id of the severity field picked in Settings, else the site's "Severity" field, or null. */
  severityField() {
    const picked = parseSeverityConfig(this.creds.severity);
    if (picked?.fieldId) return Promise.resolve(picked.fieldId);
    const site = normalizeSite(this.creds.siteUrl);
    let found = severityFields.get(site);
    if (!found) {
      found = this.call<{ id: string; name: string }[]>("/rest/api/3/field")
        .then((fields) => fields.find((f) => f.name.trim().toLowerCase() === "severity")?.id ?? null)
        .catch(() => {
          severityFields.delete(site);
          return null;
        });
      severityFields.set(site, found);
    }
    return found;
  }

  /** The site's story points field ("Story Points" or "Story point estimate"), for the Risk board. */
  pointsField() {
    const site = normalizeSite(this.creds.siteUrl);
    let found = pointsFields.get(site);
    if (!found) {
      found = this.call<{ id: string; name: string }[]>("/rest/api/3/field")
        .then((fields) => fields.find((f) => ["story points", "story point estimate"].includes(f.name.trim().toLowerCase()))?.id ?? null)
        .catch(() => {
          pointsFields.delete(site);
          return null;
        });
      pointsFields.set(site, found);
    }
    return found;
  }

  private async fields() {
    const [sev, points] = await Promise.all([this.severityField(), this.pointsField()]);
    const base = ["summary", "status", "priority", "issuetype", "parent"];
    const found = parseFoundIn(this.creds.foundIn);
    return [...base, ...(sev ? [sev] : []), ...(points ? [points] : []), ...(found ? [found.field] : [])];
  }

  private async toIssue(raw: RawIssue): Promise<JiraIssue> {
    const sev = await this.severityField();
    const value = sev ? (raw.fields[sev] as { value?: string; name?: string } | string | null | undefined) : null;
    const pf = await this.pointsField();
    const pts = pf ? raw.fields[pf] : null;
    return {
      key: raw.key,
      summary: raw.fields.summary ?? "",
      status: raw.fields.status?.name ?? "",
      category: raw.fields.status?.statusCategory?.key ?? "",
      url: `${normalizeSite(this.creds.siteUrl)}/browse/${raw.key}`,
      severity: parseSeverity(typeof value === "string" ? value : (value?.value ?? value?.name), this.scale),
      priority: (raw.fields.priority as { name?: string } | undefined)?.name ?? "",
      type: (raw.fields.issuetype as { name?: string } | undefined)?.name ?? "",
      parent: (raw.fields.parent as { key?: string } | undefined)?.key ?? null,
      points: typeof pts === "number" ? pts : null,
      foundIn: this.foundInOf(raw),
    };
  }

  /** The names in the found-in field, or null when the setting is off or Jira didn't send the field. */
  private foundInOf(raw: RawIssue) {
    const found = parseFoundIn(this.creds.foundIn);
    if (!found || !(found.field in raw.fields)) return null;
    const list = raw.fields[found.field];
    return Array.isArray(list) ? list.map((v) => (v as { name?: string })?.name ?? "").filter(Boolean).join(", ") : "";
  }

  async check() {
    const me = await this.call<{ displayName?: string }>("/rest/api/3/myself");
    await this.call(`/rest/api/3/project/${encodeURIComponent(this.creds.jiraProjectKey)}`);
    return me.displayName ?? this.creds.email;
  }

  /** The token owner's name, as Jira shows it. */
  async owner() {
    return (await this.me()).displayName;
  }

  /** The token owner's Jira account. */
  me() {
    const cacheKey = `${normalizeSite(this.creds.siteUrl)}|${this.creds.email.trim().toLowerCase()}`;
    let hit = owners.get(cacheKey);
    if (!hit) {
      hit = this.call<{ accountId?: string; displayName?: string; emailAddress?: string }>("/rest/api/3/myself").then((me) => ({
        accountId: me.accountId ?? "",
        displayName: me.displayName ?? this.creds.email,
        email: (me.emailAddress ?? this.creds.email).trim().toLowerCase(),
      }));
      hit.catch(() => owners.delete(cacheKey));
      owners.set(cacheKey, hit);
    }
    return hit;
  }

  /**
   * The person's Jira account, found by email, or null. Jira hides some
   * people's emails from the API, so a single match for the email is taken as
   * theirs even when the email itself isn't shown.
   */
  async findUser(email: string): Promise<JiraUser | null> {
    const wanted = email.trim().toLowerCase();
    const cacheKey = `${normalizeSite(this.creds.siteUrl)}|${wanted}`;
    const hit = usersByEmail.get(cacheKey);
    if (hit && Date.now() - hit.at < USER_TTL) return hit.user;
    // The token owner is known without a search, which Jira may not answer for them.
    const me = await this.me().catch(() => null);
    if (me?.accountId && (wanted === me.email || wanted === this.creds.email.trim().toLowerCase())) return { accountId: me.accountId, displayName: me.displayName, self: true };
    const found = await this.call<{ accountId: string; accountType?: string; active?: boolean; displayName?: string; emailAddress?: string }[]>(
      `/rest/api/3/user/search?query=${encodeURIComponent(wanted)}&maxResults=10`,
    );
    const people = found.filter((u) => (u.accountType ?? "atlassian") === "atlassian" && u.active !== false);
    const match = people.find((u) => u.emailAddress?.toLowerCase() === wanted) ?? (people.length === 1 && !people[0].emailAddress ? people[0] : null);
    const user = match ? { accountId: match.accountId, displayName: match.displayName ?? wanted, ...(match.accountId === me?.accountId && { self: true }) } : null;
    usersByEmail.set(cacheKey, { user, at: Date.now() });
    return user;
  }

  /** Whether the token owner may set another person as a bug's Reporter ("Modify Reporter" in the project). */
  async canSetReporter() {
    const res = await this.call<{ permissions?: Record<string, { havePermission?: boolean }> }>(
      `/rest/api/3/mypermissions?projectKey=${encodeURIComponent(this.creds.jiraProjectKey)}&permissions=MODIFY_REPORTER`,
    );
    return !!res.permissions?.MODIFY_REPORTER?.havePermission;
  }

  /**
   * The fields on the create screen for this project's issue type, with their
   * options and whether Jira requires them. Field ids differ per site, so the
   * template finds its fields here by name.
   */
  async createMeta(fresh = false): Promise<MetaField[]> {
    const cacheKey = `${normalizeSite(this.creds.siteUrl)}|${this.creds.jiraProjectKey}|${this.creds.issueType}`;
    const hit = createMetas.get(cacheKey);
    if (!fresh && hit && Date.now() - hit.at < META_TTL) return hit.fields;
    const project = encodeURIComponent(this.creds.jiraProjectKey);
    const types = await this.call<{ issueTypes?: { id: string; name: string }[]; values?: { id: string; name: string }[] }>(
      `/rest/api/3/issue/createmeta/${project}/issuetypes?maxResults=100`,
    );
    const type = (types.issueTypes ?? types.values ?? []).find((t) => t.name.toLowerCase() === this.creds.issueType.toLowerCase());
    if (!type) throw new JiraError(`The Jira project has no "${this.creds.issueType}" issue type.`);
    const raw: RawMeta[] = [];
    for (let at = 0; at < 1000; ) {
      const page = await this.call<{ fields?: RawMeta[]; values?: RawMeta[]; total?: number }>(`/rest/api/3/issue/createmeta/${project}/issuetypes/${type.id}?startAt=${at}&maxResults=200`);
      const got = page.fields ?? page.values ?? [];
      raw.push(...got);
      at += got.length;
      if (!got.length || at >= (page.total ?? at)) break;
    }
    const fields = raw.map((f) => toMeta(f));
    createMetas.set(cacheKey, { fields, at: Date.now() });
    return fields;
  }

  /**
   * The fields on the Edit screen, read from the newest bug of this type in the
   * project (Jira only says per issue). Empty when the project has no bug yet.
   */
  async editMeta(fresh = false): Promise<MetaField[]> {
    const cacheKey = `${normalizeSite(this.creds.siteUrl)}|${this.creds.jiraProjectKey}|${this.creds.issueType}`;
    const hit = editMetas.get(cacheKey);
    if (!fresh && hit && Date.now() - hit.at < META_TTL) return hit.fields;
    const q = (v: string) => v.replace(/["\\]/g, " ");
    const found = await this.call<{ issues?: { key: string }[] }>("/rest/api/3/search/jql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jql: `project = "${q(this.creds.jiraProjectKey)}" AND issuetype = "${q(this.creds.issueType)}" ORDER BY created DESC`, maxResults: 1, fields: ["summary"] }),
    });
    const key = found.issues?.[0]?.key;
    const raw = key ? await this.call<{ fields?: Record<string, RawMeta> }>(`/rest/api/3/issue/${encodeURIComponent(key)}/editmeta`) : {};
    const fields = Object.entries(raw.fields ?? {}).map(([id, f]) => toMeta(f, f.fieldId ?? f.key ?? id));
    editMetas.set(cacheKey, { fields, at: Date.now() });
    return fields;
  }

  /**
   * Every field Flaw Patrol can fill on a new bug: the Create screen's, plus the
   * Edit screen's other fields, marked `later` (set just after the bug is created).
   */
  async fieldMeta(fresh = false): Promise<MetaField[]> {
    const [create, edit] = await Promise.all([this.createMeta(fresh), this.editMeta(fresh).catch(() => [] as MetaField[])]);
    const ids = new Set(create.map((f) => f.id));
    return [...create, ...edit.filter((f) => f.id && !ids.has(f.id)).map((f) => ({ ...f, required: false, later: true }))];
  }

  /**
   * A "Stakeholder Priority" field (like OB-5292's) gets the same pick as Priority, from its own
   * list of choices; null when Jira has no such field or the pick isn't one of them.
   */
  stakeholderPriority(meta: MetaField[] | null) {
    const setting = parseTemplateSettings(this.creds.bugTemplate).priority;
    const field = meta?.find((m) => m.name.trim().toLowerCase() === "stakeholder priority" && m.options.length);
    const value = field && setting !== "" ? pickPriority(setting, field.options) : null;
    return field && value ? { field, value } : null;
  }

  /** The Jira priority every new bug gets (Settings → Jira), or null to leave it to Jira. */
  async priorityName(meta?: MetaField[] | null): Promise<string | null> {
    const setting = parseTemplateSettings(this.creds.bugTemplate).priority;
    if (setting === "") return null;
    const fields = meta ?? (await this.fieldMeta().catch(() => null));
    const f = fields?.find((m) => m.id === "priority");
    return f ? pickPriority(setting, f.options) : null;
  }

  /**
   * One issue with every field and the fields' names, to copy its layout as a
   * bug template. Nothing in Jira is changed.
   */
  async readExample(key: string) {
    const raw = await this.call<{ key: string; fields: Record<string, unknown>; names?: Record<string, string> }>(
      `/rest/api/3/issue/${encodeURIComponent(key)}?expand=names&fields=*all`,
    );
    const project = (raw.fields.project as { key?: string } | undefined)?.key ?? raw.key.replace(/-\d+$/, "");
    return { key: raw.key, project, summary: String(raw.fields.summary ?? ""), description: raw.fields.description ?? null, fields: raw.fields, names: raw.names ?? {} };
  }

  async getIssue(key: string) {
    return this.toIssue(await this.call<RawIssue>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${(await this.fields()).join(",")}`));
  }

  async search(jql: string, max = 20) {
    const res = await this.call<{ issues: RawIssue[] }>("/rest/api/3/search/jql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jql, maxResults: max, fields: await this.fields() }),
    });
    return Promise.all(res.issues.map((i) => this.toIssue(i)));
  }

  /** Stories: issues of the given types, by key or words, in one project or anywhere. */
  async searchStories(cfg: { project: string; types: string[] }, text: string) {
    const q = text.replace(/["\\]/g, " ").trim();
    const where = storyScope(cfg, this.creds.jiraProjectKey);
    const key = /^[A-Za-z][A-Za-z0-9]+-\d+$/.test(q) ? `key = "${q.toUpperCase()}" OR ` : "";
    return this.search(q ? `${where} AND (${key}text ~ "${q}*") ORDER BY updated DESC` : `${where} ORDER BY updated DESC`, 10);
  }

  /** Requirements: the issue types the requirement project has, for Settings. Sub-task types are left out. */
  async issueTypes(project: string) {
    type T = { name: string; subtask?: boolean; hierarchyLevel?: number };
    const list = project === "*" ? await this.call<T[]>("/rest/api/3/issuetype") : ((await this.call<{ issueTypes?: T[] }>(`/rest/api/3/project/${encodeURIComponent(project)}`)).issueTypes ?? []);
    return [...new Set(list.filter((t) => !t.subtask && (t.hierarchyLevel ?? 0) >= 0).map((t) => t.name))];
  }

  /** An Epic's child issues (one level down), for the Epic roll-up. */
  async childrenOf(parents: string[]) {
    if (!parents.length) return [];
    return this.search(`parent in (${parents.map((k) => `"${k.replace(/"/g, "")}"`).join(",")}) ORDER BY key ASC`, 200);
  }

  /** Every story in a Jira release (fixVersion), for coverage gaps. */
  async storiesInRelease(cfg: { project: string; types: string[] }, release: string) {
    return this.search(`${storyScope(cfg, this.creds.jiraProjectKey)} AND fixVersion = "${release.replace(/["\\]/g, " ")}" ORDER BY key ASC`, 200);
  }

  /** Several issues by key. One unknown key fails Jira's whole search, so then they're read one by one. */
  async getMany(keys: string[]) {
    if (!keys.length) return [];
    try {
      return await this.search(`key in (${keys.map((k) => `"${k}"`).join(",")})`, keys.length);
    } catch (e) {
      if (!(e instanceof JiraError) || /rejected|reach/.test(e.message)) throw e;
      const out: JiraIssue[] = [];
      for (const k of keys) {
        const one = await this.getIssue(k).catch(() => null);
        if (one) out.push(one);
      }
      return out;
    }
  }

  /** A project's releases (versions), newest first. */
  async versions(project: string) {
    const list = await this.call<{ name: string; released?: boolean; archived?: boolean; releaseDate?: string }[]>(`/rest/api/3/project/${encodeURIComponent(project)}/versions`);
    return list.filter((v) => !v.archived).map((v) => v.name).reverse();
  }

  /** The bug project's versions, newest first, with whether each is released. Archived ones are left out. */
  async versionList(): Promise<JiraVersion[]> {
    const list = await this.call<{ name: string; released?: boolean; archived?: boolean }[]>(`/rest/api/3/project/${encodeURIComponent(this.creds.jiraProjectKey)}/versions`);
    return list
      .filter((v) => !v.archived && v.name)
      .map((v) => ({ name: v.name, released: !!v.released }))
      .reverse();
  }

  /** Link a new bug to a story with Jira's "Relates" link: the only story write Flaw Patrol makes. */
  async relate(bugKey: string, storyKey: string) {
    await this.call("/rest/api/3/issueLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: { name: "Relates" }, inwardIssue: { key: bugKey }, outwardIssue: { key: storyKey } }),
    });
  }

  /** Bugs in the connected Jira project matching the text, newest first. */
  async searchBugs(text: string) {
    const q = text.replace(/["\\]/g, " ").trim();
    const project = `project = "${this.creds.jiraProjectKey}" AND issuetype = "${this.creds.issueType}"`;
    return this.search(q ? `${project} AND text ~ "${q}*" ORDER BY updated DESC` : `${project} ORDER BY updated DESC`, 15);
  }

  /**
   * File a bug. The reporter is the tester who filed it when their Jira account
   * is known; Jira always records the token owner as the hidden Creator. Jira
   * refuses a whole bug over one field it won't take (the reporter without
   * "Modify Reporter", a field missing from the create screen, an option that
   * doesn't exist), so a refused field is dropped and the bug filed again, with
   * `description` told what was dropped so it can carry those values instead.
   * Priority is the one picked in Settings → Jira ("Not Prioritized" unless
   * changed), so whoever triages sets the real one. Fields that are only on
   * Jira's Edit screen (Severity on some sites) are set just after the bug is
   * created; any Jira still refuses go into the description. When the tester is
   * the token owner, Jira makes them the Reporter anyway, so the field isn't
   * sent (it needs "Modify Reporter" even for yourself).
   */
  async createIssue(input: {
    summary: string;
    description: (left: { reporterSet: boolean; dropped: string[] }) => object;
    severity: Severity;
    reporterId?: string;
    /** Extra fields by Jira field id. */
    fields?: Record<string, { name: string; value: unknown }>;
  }) {
    const sev = await this.severityField();
    const found = this.foundIn?.value ? this.foundIn : null;
    const meta = await this.fieldMeta().catch(() => null);
    const priority = await this.priorityName(meta);
    const severityLabel = this.scale.labels[input.severity];
    const stake = this.stakeholderPriority(meta);
    const stakeValue = stake ? jiraValue(stake.field, stake.value) : undefined;
    const optional: Record<string, { name: string; value: unknown }> = {
      ...(priority ? { priority: { name: "Priority", value: { name: priority } } } : {}),
      ...(stake && stakeValue !== undefined ? { [stake.field.id]: { name: stake.field.name, value: stakeValue } } : {}),
      ...(sev ? { [sev]: { name: "Severity", value: { value: severityLabel } } } : {}),
      ...(this.labels.length ? { labels: { name: "Labels", value: this.labels } } : {}),
      // Found-in version, unless the bug's own layout fills the same field.
      ...(found?.known ? { [found.field]: { name: found.label, value: [{ name: found.value }] } } : {}),
      ...input.fields,
    };
    // Fields only on the Edit screen wait until the bug exists.
    const later = new Set(Object.keys(optional).filter((id) => meta?.find((m) => m.id === id)?.later));
    // A version Jira doesn't have, or one it refused, is said first in the description instead; so is a refused severity.
    const foundLead = (gone: Set<string>) => [
      ...(!found || input.fields?.[found.field] ? [] : !found.known ? [foundInLine(found.label, found.value, "missing")] : gone.has(found.field) ? [foundInLine(found.label, found.value, "refused")] : []),
      ...(sev && !input.fields?.[sev] && gone.has(sev) ? [`Severity: ${severityLabel}`] : []),
    ];
    let reporterSet = !!input.reporterId;
    const self = reporterSet && input.reporterId === (await this.me().catch(() => null))?.accountId;
    const dropped = new Set<string>();
    for (let round = 0; round < 8; round++) {
      const extra = Object.fromEntries(Object.entries(optional).filter(([id]) => !dropped.has(id) && !later.has(id)).map(([id, f]) => [id, f.value]));
      const names = [...dropped].map((id) => optional[id].name);
      const fields = {
        project: { key: this.creds.jiraProjectKey },
        issuetype: { name: this.creds.issueType },
        summary: input.summary,
        description: this.withLead(input.description({ reporterSet, dropped: names }), foundLead(dropped)),
        ...(reporterSet && !self ? { reporter: { id: input.reporterId } } : {}),
        ...extra,
      };
      try {
        const { key } = await this.call<{ key: string }>("/rest/api/3/issue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
        const late = [...later].filter((id) => !dropped.has(id));
        if (late.length) {
          const gone = await this.setLater(key, Object.fromEntries(late.map((id) => [id, optional[id].value])));
          if (gone.length) {
            // What Jira wouldn't take even now goes into the description, as a refused field would have.
            for (const id of gone) dropped.add(id);
            names.push(...gone.map((id) => optional[id].name));
            await this.call(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fields: { description: this.withLead(input.description({ reporterSet, dropped: names }), foundLead(dropped)) } }),
            }).catch(() => {});
          }
        }
        const foundSet = !!found?.known && !input.fields?.[found.field] && !dropped.has(found.field);
        return { key, reporterSet, dropped: names, foundSet };
      } catch (e) {
        if (!(e instanceof JiraError) || /rejected|reach/.test(e.message)) throw e;
        const blamed = Object.keys(e.fields);
        const before = dropped.size + Number(reporterSet);
        if (blamed.includes("reporter")) reporterSet = false;
        for (const id of blamed) if (id in optional) dropped.add(id);
        if (dropped.size + Number(reporterSet) < before) continue;
        // Jira didn't say which field: give up the reporter first, then every extra field.
        if (reporterSet) reporterSet = false;
        else if (Object.keys(optional).some((id) => !dropped.has(id))) for (const id of Object.keys(optional)) dropped.add(id);
        else throw e;
      }
    }
    throw new JiraError("Couldn't file the bug.");
  }

  /**
   * Set fields on a bug that was just created, the way someone editing it in Jira
   * would. A field Jira refuses is left out and the rest sent again. Returns the
   * ids Jira wouldn't take.
   */
  private async setLater(key: string, fields: Record<string, unknown>): Promise<string[]> {
    const gone = new Set<string>();
    for (let round = 0; round < 8; round++) {
      const left = Object.fromEntries(Object.entries(fields).filter(([id]) => !gone.has(id)));
      if (!Object.keys(left).length) break;
      try {
        await this.call(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: left }) });
        break;
      } catch (e) {
        if (!(e instanceof JiraError)) throw e;
        const blamed = Object.keys(e.fields).filter((id) => id in left);
        // Jira didn't say which: give them all up rather than guess.
        for (const id of blamed.length ? blamed : Object.keys(left)) gone.add(id);
      }
    }
    return [...gone];
  }

  /**
   * Replace an issue's description. Jira lets only admins turn off the "issue
   * updated" email (notifyUsers=false), so this edit sends Jira's usual one.
   */
  async setDescription(key: string, description: object, opts: { asIs?: boolean } = {}) {
    await this.call(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { description: opts.asIs ? description : this.withLead(description) } }),
    });
  }

  /** An issue's description as Jira has it now (its document), or null when it has none. */
  async getDescription(key: string): Promise<unknown> {
    const raw = await this.call<{ fields?: { description?: unknown } }>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=description`);
    return raw.fields?.description ?? null;
  }

  /**
   * The media id Jira's editor uses to show an attachment inline, read from where
   * its download redirects; null when Jira doesn't say.
   */
  async mediaId(attachmentId: string): Promise<string | null> {
    const auth = Buffer.from(`${this.creds.email}:${this.creds.token}`).toString("base64");
    try {
      const res = await fetch(`${normalizeSite(this.creds.siteUrl)}/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}`, {
        headers: { Authorization: `Basic ${auth}` },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      await res.body?.cancel();
      return /\/file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(res.headers.get("location") ?? "")?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /** A link that opens an attachment in the browser for anyone who can see the issue. */
  attachmentUrl(id: string, fileName: string) {
    return `${normalizeSite(this.creds.siteUrl)}/secure/attachment/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}`;
  }

  /** Upload files to an issue; Jira's ids for them, in the same order. */
  async attach(key: string, files: { fileName: string; contentType: string; data: Uint8Array }[]): Promise<{ id: string; filename: string }[]> {
    if (!files.length) return [];
    const form = new FormData();
    for (const f of files) form.append("file", new Blob([new Uint8Array(f.data)], { type: f.contentType }), f.fileName);
    const added = await this.call<{ id: string | number; filename: string }[] | undefined>(`/rest/api/3/issue/${encodeURIComponent(key)}/attachments`, {
      method: "POST",
      headers: { "X-Atlassian-Token": "no-check" },
      body: form,
    });
    return (added ?? []).map((a) => ({ id: String(a.id), filename: a.filename }));
  }
}

/**
 * Pull current Jira status for linked defects in a project, at most every few
 * minutes unless forced. Jira rejects a whole `key in (...)` search when any one
 * key is gone or hidden, so keys a search doesn't return are fetched one by one,
 * and the ones that still fail are reported rather than silently skipped.
 */
export async function refreshDefectStatuses(projectId: string, force = false) {
  const client = await jiraFor(projectId);
  if (!client) return { refreshed: 0, failed: [] as string[] };
  const stale = new Date(Date.now() - (force ? 0 : 5 * 60_000));
  const defects = await db.defect.findMany({
    where: { projectId, externalKey: { not: null }, OR: [{ syncedAt: null }, { syncedAt: { lt: stale } }] },
    select: { id: true, externalKey: true },
    take: 500,
  });
  let refreshed = 0;
  const failed: string[] = [];
  for (let i = 0; i < defects.length; i += 50) {
    const chunk = defects.slice(i, i + 50);
    const keys = chunk.map((d) => d.externalKey!).filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k));
    if (!keys.length) continue;
    const issues = await client.search(`key in (${keys.join(",")})`, 50).catch(() => [] as JiraIssue[]);
    const byKey = new Map(issues.map((i) => [i.key, i]));
    for (const d of chunk) {
      let issue = byKey.get(d.externalKey!);
      if (!issue) {
        try {
          issue = await client.getIssue(d.externalKey!);
        } catch (e) {
          // A bad token or unreachable site fails every key the same way; say so once.
          if (e instanceof JiraError && /rejected|reach/.test(e.message)) throw e;
          failed.push(`${d.externalKey} (${e instanceof Error ? e.message : "unknown error"})`);
          continue;
        }
      }
      await db.defect.update({
        where: { id: d.id },
        data: {
          title: issue.summary,
          externalStatus: issue.status,
          externalCategory: issue.category,
          status: issue.category === "done" ? "FIXED" : "OPEN",
          externalPriority: issue.priority || null,
          // Jira's Severity field is the source of truth when the site has one.
          ...(issue.severity && { severity: issue.severity }),
          // Found-in version: a version set in Jira comes back here. An empty field keeps
          // what was filed, since a release Jira didn't have is only in the description.
          ...(issue.foundIn && { foundIn: issue.foundIn }),
          syncedAt: new Date(),
        },
      });
      refreshed++;
    }
  }
  return { refreshed, failed };
}
