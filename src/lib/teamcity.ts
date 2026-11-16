import "server-only";
import { assertOutbound, OutboundBlocked } from "./outbound";

// TeamCity (ver_228): read builds for the Status page with an access token.
// Read-only: only GET requests, and never anything about who started a build.
// https://www.jetbrains.com/help/teamcity/rest/teamcity-rest-api-documentation.html

export class TeamCityError extends Error {
  /** The token was turned down (401/403), so an Admin has to paste a new one. */
  constructor(
    message: string,
    readonly token = false,
  ) {
    super(message);
  }
}

export type TeamCityBuildType = { id: string; name: string; project: string };
export type TeamCityBuild = {
  id: number;
  number: string;
  /** SUCCESS, FAILURE, ERROR or UNKNOWN. */
  status: string;
  /** queued, running or finished. */
  state: string;
  /** TeamCity's own one-line summary, like "Tests failed: 14 (2 new), passed: 310". */
  statusText: string;
  branch: string;
  /** When it finished (or started, while running), as an ISO date. */
  at: string | null;
  url: string;
  failedToStart: boolean;
};

/** "https://tc.example.com" from what someone typed: adds https://, drops a trailing slash and anything after /app or /viewType. */
export function teamcityBase(input: string): string {
  let s = input.trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const path = u.pathname.replace(/\/(app|viewType\.html|buildConfiguration|project|favorite|admin|overview\.html)(\/.*)?$/i, "").replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

/** TeamCity's dates look like 20261112T030200+0000. */
export function teamcityDate(v: string | undefined | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/.exec(v ?? "");
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]}:${m[8]}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type RawBuild = {
  id: number;
  number?: string;
  status?: string;
  state?: string;
  statusText?: string;
  branchName?: string;
  finishDate?: string;
  startDate?: string;
  queuedDate?: string;
  webUrl?: string;
  failedToStart?: boolean;
};

export function toBuild(b: RawBuild): TeamCityBuild {
  return {
    id: b.id,
    number: b.number ?? "",
    status: (b.status ?? "UNKNOWN").toUpperCase(),
    state: b.state ?? "finished",
    statusText: (b.statusText ?? "").trim(),
    branch: (b.branchName ?? "").replace(/^refs\/heads\//, ""),
    at: teamcityDate(b.finishDate) ?? teamcityDate(b.startDate) ?? teamcityDate(b.queuedDate),
    url: b.webUrl ?? "",
    failedToStart: !!b.failedToStart,
  };
}

export class TeamCityClient {
  constructor(
    private base: string,
    private token: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    try {
      await assertOutbound(this.base, "TeamCity");
    } catch (e) {
      if (e instanceof OutboundBlocked) throw new TeamCityError(e.message);
      throw e;
    }
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", "User-Agent": "Flaw-Patrol" },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new TeamCityError(`Couldn't reach TeamCity at ${this.base}. Check the address, and that this server can reach it.`);
    }
    if (res.status === 401) throw new TeamCityError("TeamCity turned down the access token. Check it was copied in full and hasn't expired or been deleted.", true);
    if (res.status === 403) throw new TeamCityError("The TeamCity token can't read these builds. Give its user the View build runtime parameters and data permission, or use a token from someone who can see them.", true);
    if (res.status === 404) throw new TeamCityError("TeamCity couldn't find that. Check the server address and that the build configuration still exists.");
    if (res.status >= 300 && res.status < 400) throw new TeamCityError("TeamCity sent Flaw Patrol to a sign-in page. Check the server address and the token.", true);
    if (!res.ok) throw new TeamCityError(`TeamCity said ${res.status} ${res.statusText}.`);
    try {
      return (await res.json()) as T;
    } catch {
      throw new TeamCityError("That address answered, but not like a TeamCity server. Check the server address.");
    }
  }

  /** The server's version: proves the address and token work. */
  async server(): Promise<string> {
    const r = await this.get<{ version?: string }>("/app/rest/server?fields=version");
    return r.version ?? "";
  }

  /** Every build configuration the token can see, by project. */
  async buildTypes(): Promise<TeamCityBuildType[]> {
    const r = await this.get<{ buildType?: { id: string; name: string; projectName?: string }[] }>("/app/rest/buildTypes?fields=buildType(id,name,projectName)");
    return (r.buildType ?? []).map((b) => ({ id: b.id, name: b.name, project: b.projectName ?? "" }));
  }

  /** A build configuration's newest builds, newest first. Only build fields are asked for: never who started them. */
  async builds(buildTypeId: string, count = 5): Promise<TeamCityBuild[]> {
    const locator = `buildType:(id:${buildTypeId}),branch:default:any,count:${count}`;
    const fields = "build(id,number,status,state,statusText,branchName,finishDate,startDate,queuedDate,webUrl,failedToStart)";
    const r = await this.get<{ build?: RawBuild[] }>(`/app/rest/builds?locator=${encodeURIComponent(locator)}&fields=${encodeURIComponent(fields)}`);
    return (r.build ?? []).map(toBuild);
  }
}
