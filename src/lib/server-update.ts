// Updates from Workspace settings (ver_238). Flaw Patrol can't rebuild its own container, so
// the Update button only leaves a note in a folder shared with the server; the update helper
// (scripts/server-update.sh) picks it up, does the update, and writes back how it's going.
// Every file in the folder is plain key=value or tab-separated lines, so the helper needs no
// tools beyond the shell. Laptop copies have no folder, and the card says how to set it up.

/** How long without a sign of life before the helper counts as stopped. A build goes quiet for minutes. */
const QUIET_MS = 2 * 60_000;
const QUIET_UPDATING_MS = 20 * 60_000;

export type UpdateState = "idle" | "updating" | "done" | "failed";

export type UpdateStatus = {
  state: UpdateState;
  id: string;
  by: string;
  step: string;
  message: string;
  started: string | null;
  finished: string | null;
  from: string;
  to: string;
  backup: string;
  seen: string | null;
};

export type RemoteInfo = {
  checked: string | null;
  current: string;
  latest: string;
  latestCommit: string;
  behind: number;
  ahead: number;
  /** Files changed on the server itself, which can stop new code coming in. */
  changed: string[];
  error: string;
};

export type ServerUpdateView = {
  /** "none": not set up on this copy; "folder": Flaw Patrol can't write its note; "helper": the helper isn't running. */
  problem: "none" | "folder" | "helper" | null;
  helperSeen: string | null;
  status: UpdateStatus | null;
  remote: RemoteInfo | null;
  commits: { sha: string; subject: string }[];
  migrations: string[];
  /** A note Flaw Patrol left that the helper hasn't picked up yet. */
  waiting: "update" | "check" | null;
  log: string;
};

/** key=value lines; later keys win, lines without = are skipped. */
export function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

const STATES: UpdateState[] = ["idle", "updating", "done", "failed"];
const when = (v: string | undefined) => (v && !Number.isNaN(Date.parse(v)) ? v : null);
const count = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : 0);

export function parseStatus(text: string): UpdateStatus {
  const kv = parseKeyValues(text);
  return {
    state: STATES.includes(kv.state as UpdateState) ? (kv.state as UpdateState) : "idle",
    id: kv.id ?? "",
    by: kv.by ?? "",
    step: kv.step ?? "",
    message: kv.message ?? "",
    started: when(kv.started),
    finished: when(kv.finished),
    from: kv.from ?? "",
    to: kv.to ?? "",
    backup: kv.backup ?? "",
    seen: when(kv.seen),
  };
}

export function parseRemote(text: string): RemoteInfo {
  const kv = parseKeyValues(text);
  return {
    checked: when(kv.checked),
    current: kv.current ?? "",
    latest: kv.latest ?? "",
    latestCommit: kv.latestCommit ?? "",
    behind: count(kv.behind),
    ahead: count(kv.ahead),
    changed: (kv.changed ?? "").split(/\s+/).filter(Boolean),
    error: kv.error ?? "",
  };
}

export function parseCommits(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const tab = line.indexOf("\t");
      return tab > 0 ? { sha: line.slice(0, tab).trim(), subject: line.slice(tab + 1).trim() } : null;
    })
    .filter((c): c is { sha: string; subject: string } => !!c && /^[0-9a-f]{4,40}$/.test(c.sha));
}

export function parseMigrations(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+$/.test(l));
}

/** Is the helper still going? It writes its status every few seconds, but not while Docker builds. */
export function helperRunning(status: UpdateStatus | null, now: Date) {
  if (!status?.seen) return false;
  const quiet = now.getTime() - Date.parse(status.seen);
  return quiet < (status.state === "updating" ? QUIET_UPDATING_MS : QUIET_MS);
}

/** "0.3.0-alpha.237" → 237, for comparing builds; null when it isn't one. */
export function buildNumber(version: string) {
  const m = /alpha\.(\d+)$/.exec(version.trim());
  return m ? Number(m[1]) : null;
}

/** Can someone press Update now, and if not, why not (shown under the button). */
export function updateBlocked(v: ServerUpdateView): string | null {
  if (v.problem === "none") return "Updates aren't set up on this copy of Flaw Patrol.";
  if (v.problem === "folder") return "Flaw Patrol can't reach the update helper's folder yet.";
  if (v.problem === "helper") return "The update helper isn't running on the server.";
  if (v.status?.state === "updating") return "An update is already going.";
  if (v.waiting === "update") return "Waiting for the update helper to start.";
  return null;
}

/** The last lines of the helper's log, enough to see what went wrong. */
export function logTail(text: string, lines = 60) {
  const all = text.replace(/\r/g, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd().split("\n");
  return all.slice(-lines).join("\n").trim();
}
