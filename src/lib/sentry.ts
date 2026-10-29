import "server-only";

// Sentry for testers (ver_96): Flaw Patrol only reads from Sentry with a read-only token
// (Project, Issue & Event and Organization read), so it works before Flaw Patrol is hosted.
// Nothing here writes to Sentry.

export class SentryError extends Error {}

export type SentryProject = { id: string; slug: string; name: string };
export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  url: string;
  project: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
};
/** One error as Flaw Patrol keeps it on a step result and puts it in a bug. */
export type SentryRef = {
  id: string;
  shortId: string;
  title: string;
  url: string;
  project: string;
  count: number;
  firstSeen: string;
  /** "New in this build" when it first showed up after the run started. */
  fresh: boolean;
  frames: string[];
  release: string;
  environment: string;
  stepIndex?: number | null;
};

export const SENTRY_CLOUD = "https://sentry.io";

/** "sentry.io" or "https://sentry.example.com/" → "https://sentry.example.com". */
export function sentryBase(input: string) {
  const s = input.trim().replace(/\/+$/, "") || SENTRY_CLOUD;
  return /^https?:\/\//.test(s) ? s : `https://${s}`;
}

export class SentryClient {
  constructor(
    readonly base: string,
    readonly token: string,
    readonly org = "",
  ) {}

  private async call<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${sentryBase(this.base)}/api/0${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      throw new SentryError(`Couldn't reach Sentry at ${sentryBase(this.base)}. Check the address.`);
    }
    if (res.status === 401) throw new SentryError("Sentry didn't accept the token. Make a new one and paste it again.");
    if (res.status === 403) throw new SentryError("The token can't read that. Give it Project, Issue & Event and Organization read.");
    if (res.status === 404) throw new SentryError("Sentry couldn't find that organization or project.");
    if (!res.ok) throw new SentryError(`Sentry answered ${res.status}.`);
    return (await res.json()) as T;
  }

  /** The organizations the token can see, to fill in Organization. */
  async organizations() {
    const list = await this.call<{ slug: string; name: string }[]>("/organizations/");
    return list.map((o) => ({ slug: o.slug, name: o.name }));
  }

  /** Who the token belongs to, for "Connected as". Self-hosted Sentry may not say. */
  async whoAmI() {
    return this.call<{ email?: string; username?: string }>("/").then(
      (r) => (r as { user?: { email?: string } }).user?.email ?? null,
      () => null,
    );
  }

  async projects(): Promise<SentryProject[]> {
    const list = await this.call<{ id: string; slug: string; name: string }[]>(`/organizations/${enc(this.org)}/projects/`);
    return list.map((p) => ({ id: String(p.id), slug: p.slug, name: p.name }));
  }

  async environments(projectSlug: string): Promise<string[]> {
    const list = await this.call<{ name: string }[]>(`/projects/${enc(this.org)}/${enc(projectSlug)}/environments/`).catch(() => []);
    return list.map((e) => e.name);
  }

  /** The release whose name contains the run's build ("4.12.0 (812)" → "mobile-ios@4.12.0+812"), or null. */
  async releaseFor(build: string, projectIds: string[]): Promise<string | null> {
    const parts = build.match(/[\w.+-]+/g) ?? [];
    if (!parts.length) return null;
    const q = [...parts].sort((a, b) => b.length - a.length)[0] ?? "";
    const list = await this.call<{ version: string }[]>(`/organizations/${enc(this.org)}/releases/?query=${enc(q)}${projectIds.map((p) => `&project=${enc(p)}`).join("")}&per_page=25`).catch(() => []);
    const all = parts.filter((p) => /\d/.test(p));
    return list.find((r) => all.every((p) => r.version.includes(p)))?.version ?? list[0]?.version ?? null;
  }

  /** Issues with events in a time window, newest first. */
  async issues(opts: { projectIds: string[]; start: Date; end: Date; environment?: string; query?: string; limit?: number }): Promise<SentryIssue[]> {
    const params = new URLSearchParams({
      start: opts.start.toISOString(),
      end: opts.end.toISOString(),
      query: opts.query ?? "",
      sort: "date",
      limit: String(opts.limit ?? 10),
    });
    for (const p of opts.projectIds) params.append("project", p);
    if (opts.environment) params.append("environment", opts.environment);
    const list = await this.call<RawIssue[]>(`/organizations/${enc(this.org)}/issues/?${params}`);
    return list.map(issueOf);
  }

  /** The top in-app frames of an issue's latest event, innermost first, like "PaymentSheet.confirm (PaymentSheet.tsx:88)". */
  async topFrames(issueId: string, n = 2): Promise<string[]> {
    const ev = await this.call<{ entries?: { type: string; data?: { values?: { stacktrace?: { frames?: Frame[] } }[] } }[] }>(`/issues/${enc(issueId)}/events/latest/`).catch(() => null);
    const frames = ev?.entries?.find((e) => e.type === "exception")?.data?.values?.flatMap((v) => v.stacktrace?.frames ?? []) ?? [];
    const own = frames.filter((f) => f.inApp);
    return (own.length ? own : frames)
      .slice()
      .reverse()
      .slice(0, n)
      .map((f) => `${f.function ?? "?"} (${f.filename ?? f.module ?? "?"}${f.lineNo ? `:${f.lineNo}` : ""})`);
  }

  /** Crash-free sessions for a release over the last 14 days, 0 to 1, or null when Sentry has no sessions. */
  async crashFree(release: string, projectIds: string[]): Promise<number | null> {
    const params = new URLSearchParams({ field: "crash_free_rate(session)", statsPeriod: "14d", query: `release:"${release}"`, interval: "1d" });
    for (const p of projectIds) params.append("project", p);
    const r = await this.call<{ groups?: { totals?: Record<string, number | null> }[] }>(`/organizations/${enc(this.org)}/sessions/?${params}`).catch(() => null);
    const v = r?.groups?.[0]?.totals?.["crash_free_rate(session)"];
    return typeof v === "number" ? v : null;
  }

  /** How many issues first appeared in this release (up to 100). */
  async newInRelease(release: string, projectIds: string[]): Promise<number> {
    const params = new URLSearchParams({ query: `first-release:"${release}"`, statsPeriod: "90d", limit: "100" });
    for (const p of projectIds) params.append("project", p);
    const list = await this.call<RawIssue[]>(`/organizations/${enc(this.org)}/issues/?${params}`).catch(() => []);
    return list.length;
  }

  /** Link to an issue search in Sentry. */
  searchUrl(query: string, projectIds: string[]) {
    const params = new URLSearchParams({ query });
    for (const p of projectIds) params.append("project", p);
    return `${sentryBase(this.base)}/organizations/${enc(this.org)}/issues/?${params}`;
  }
}

type RawIssue = { id: string; shortId: string; title: string; culprit?: string; permalink: string; project?: { slug?: string }; count?: string | number; firstSeen: string; lastSeen: string };
type Frame = { function?: string; filename?: string; module?: string; lineNo?: number; inApp?: boolean };
const enc = encodeURIComponent;
const issueOf = (i: RawIssue): SentryIssue => ({
  id: String(i.id),
  shortId: i.shortId,
  title: i.title,
  culprit: i.culprit ?? "",
  url: i.permalink,
  project: i.project?.slug ?? "",
  count: Number(i.count ?? 0),
  firstSeen: i.firstSeen,
  lastSeen: i.lastSeen,
});

export function parseSentryRefs(v: unknown): SentryRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is SentryRef => !!x && typeof x === "object" && typeof (x as SentryRef).id === "string" && typeof (x as SentryRef).url === "string")
    .slice(0, 20)
    .map((x) => ({
      id: x.id,
      shortId: String(x.shortId ?? ""),
      title: String(x.title ?? "").slice(0, 300),
      url: x.url,
      project: String(x.project ?? ""),
      count: Number(x.count ?? 0),
      firstSeen: String(x.firstSeen ?? ""),
      fresh: !!x.fresh,
      frames: Array.isArray(x.frames) ? x.frames.map(String).slice(0, 3) : [],
      release: String(x.release ?? ""),
      environment: String(x.environment ?? ""),
      stepIndex: typeof x.stepIndex === "number" ? x.stepIndex : null,
    }));
}

/** The Sentry errors section at the end of a Jira bug's description (Atlassian Document Format). */
export function sentryAdf(refs: SentryRef[]): object[] {
  if (!refs.length) return [];
  const text = (t: string, marks?: object[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
  return [
    { type: "heading", attrs: { level: 3 }, content: [text("Sentry errors")] },
    ...refs.flatMap((r) => [
      { type: "paragraph", content: [text(r.shortId || "Sentry", [{ type: "link", attrs: { href: r.url } }]), text(` ${r.title}`)] },
      ...(r.frames.length ? [{ type: "codeBlock", content: [text(r.frames.map((f) => `at ${f}`).join("\n"))] }] : []),
      {
        type: "paragraph",
        content: [text([r.release && `Release ${r.release}`, r.environment, `${r.count} ${r.count === 1 ? "event" : "events"}`, r.firstSeen && `first seen ${new Date(r.firstSeen).toUTCString().slice(5, 22)} UTC`].filter(Boolean).join(" · "), [{ type: "em" }])],
      },
    ]),
  ];
}
