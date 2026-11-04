import "server-only";

// Qase (ver_164): talk to Qase's API v1 with a project's API token.
// https://developers.qase.io — the token goes in the "Token" header.

/** Qase's API, or a stand-in for the e2e tests. */
const API = () => (process.env.QASE_API_URL || "https://api.qase.io/v1").replace(/\/$/, "");

export class QaseError extends Error {}

export type QaseProject = { code: string; title: string };
export type QaseCase = { id: number; title: string };
export type QaseRun = { id: number; title: string; status: string };
export type QaseResult = { hash: string; caseId: number; status: string; endTime: string | null; comment: string };

type Envelope<T> = { status?: boolean; result?: T; errorMessage?: string; message?: string };
type Page<T> = { total?: number; filtered?: number; count?: number; entities?: T[] };

/** The most Qase cases or results read in one go, 100 at a time. */
const MAX_ROWS = 5000;

export class QaseClient {
  constructor(private token: string) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API()}${path}`, {
        method,
        headers: { Token: this.token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), "User-Agent": "Flaw-Patrol" },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new QaseError("Couldn't reach Qase. Check this computer's internet connection.");
    }
    if (res.status === 401) throw new QaseError("Qase didn't accept the API token. Check it was copied in full and hasn't been revoked.");
    if (res.status === 403) throw new QaseError("The Qase token can't do this. In Qase, check the token's user can see this project and that your Qase plan includes API access.");
    if (res.status === 429) throw new QaseError("Qase asked Flaw Patrol to slow down. Try again in a minute.");
    const json = (await res.json().catch(() => ({}))) as Envelope<T>;
    if (res.status === 404) throw new QaseError(json.errorMessage || json.message || "Qase couldn't find that. Check the project code.");
    if (!res.ok || json.status === false) throw new QaseError(`Qase said: ${json.errorMessage || json.message || `${res.status} ${res.statusText}`}`);
    return json.result as T;
  }

  /** Every page of a list, up to MAX_ROWS rows. */
  private async all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    const join = path.includes("?") ? "&" : "?";
    for (let offset = 0; offset < MAX_ROWS; offset += 100) {
      const page = await this.call<Page<T>>("GET", `${path}${join}limit=100&offset=${offset}`);
      const rows = page?.entities ?? [];
      out.push(...rows);
      if (rows.length < 100) break;
    }
    return out;
  }

  async projects(): Promise<QaseProject[]> {
    const rows = await this.all<{ code: string; title: string }>("/project");
    return rows.map((p) => ({ code: p.code, title: p.title }));
  }

  async project(code: string): Promise<QaseProject> {
    const p = await this.call<{ code: string; title: string }>("GET", `/project/${encodeURIComponent(code)}`);
    return { code: p.code, title: p.title };
  }

  async cases(code: string): Promise<QaseCase[]> {
    const rows = await this.all<{ id: number; title: string }>(`/case/${encodeURIComponent(code)}`);
    return rows.map((c) => ({ id: c.id, title: c.title ?? "" }));
  }

  async runs(code: string): Promise<QaseRun[]> {
    const rows = await this.all<{ id: number; title: string; status_text?: string; status?: number }>(`/run/${encodeURIComponent(code)}?status=active`);
    return rows.map((r) => ({ id: r.id, title: r.title ?? `Run ${r.id}`, status: r.status_text ?? "" }));
  }

  async run(code: string, id: number): Promise<QaseRun> {
    const r = await this.call<{ id: number; title: string; status_text?: string }>("GET", `/run/${encodeURIComponent(code)}/${id}`);
    return { id: r.id, title: r.title ?? `Run ${r.id}`, status: r.status_text ?? "" };
  }

  async createRun(code: string, title: string, cases: number[]): Promise<number> {
    const r = await this.call<{ id: number }>("POST", `/run/${encodeURIComponent(code)}`, { title: title.slice(0, 255), description: "Shared from Flaw Patrol", cases });
    return r.id;
  }

  async addResult(code: string, runId: number, r: { caseId: number; status: string; comment: string; timeMs?: number | null }): Promise<string> {
    const out = await this.call<{ hash: string }>("POST", `/result/${encodeURIComponent(code)}/${runId}`, {
      case_id: r.caseId,
      status: r.status,
      comment: r.comment.slice(0, 10000),
      ...(r.timeMs ? { time_ms: r.timeMs } : {}),
    });
    return out?.hash ?? "";
  }

  async results(code: string, runId: number): Promise<QaseResult[]> {
    // Both spellings of the run filter; rows from other runs are dropped either way.
    const rows = await this.all<{ hash: string; run_id?: number; case_id: number; status: string; end_time?: string | null; comment?: string | null }>(`/result/${encodeURIComponent(code)}?run=${runId}&filters%5Brun%5D=${runId}`);
    return rows.filter((r) => r.run_id === undefined || r.run_id === runId).map((r) => ({ hash: r.hash, caseId: r.case_id, status: (r.status ?? "").toLowerCase(), endTime: r.end_time ?? null, comment: r.comment ?? "" }));
  }
}

/** Where a person opens a Qase run, or the project's runs. */
export const qaseRunUrl = (code: string, runId?: number | null) => (runId ? `https://app.qase.io/run/${code}/dashboard/${runId}` : `https://app.qase.io/run/${code}`);
