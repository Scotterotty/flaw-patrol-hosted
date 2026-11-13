import "server-only";
import { randomBytes } from "node:crypto";
import { access, constants, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { helperRunning, logTail, parseCommits, parseMigrations, parseRemote, parseStatus, type ServerUpdateView } from "./server-update";

// The folder shared with the update helper (docker-compose.hosting.yml mounts it). See server-update.ts.

const dir = () => process.env.SERVER_UPDATE_DIR?.trim() || null;

async function read(name: string) {
  const d = dir();
  if (!d) return null;
  try {
    return await readFile(join(d, name), "utf8");
  } catch {
    return null;
  }
}

async function writable(d: string) {
  try {
    await access(d, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readServerUpdate(now = new Date()): Promise<ServerUpdateView> {
  const d = dir();
  if (!d) return { problem: "none", helperSeen: null, status: null, remote: null, commits: [], migrations: [], waiting: null, log: "" };
  const [statusText, remoteText, commitsText, migrationsText, requestText, logText, canWrite] = await Promise.all([
    read("status"),
    read("remote"),
    read("commits"),
    read("migrations"),
    read("request"),
    read("update.log"),
    writable(d),
  ]);
  const status = statusText ? parseStatus(statusText) : null;
  const kind = requestText ? /^kind=(update|check)$/m.exec(requestText)?.[1] : null;
  return {
    problem: !canWrite ? "folder" : !helperRunning(status, now) ? "helper" : null,
    helperSeen: status?.seen ?? null,
    status,
    remote: remoteText ? parseRemote(remoteText) : null,
    commits: commitsText ? parseCommits(commitsText) : [],
    migrations: migrationsText ? parseMigrations(migrationsText) : [],
    waiting: kind === "update" || kind === "check" ? kind : null,
    log: logText ? logTail(logText) : "",
  };
}

/** Leave the helper a note. Only kind, a random id and who asked go in it; the helper runs nothing from it. */
export async function leaveRequest(kind: "update" | "check", by: string) {
  const d = dir();
  if (!d) throw new Error("Updates aren't set up on this copy.");
  const id = randomBytes(6).toString("hex");
  const safeBy = by.replace(/[^A-Za-z0-9 .@_+-]/g, "").slice(0, 120);
  const tmp = join(d, `.request-${id}`);
  await writeFile(tmp, `kind=${kind}\nid=${id}\nby=${safeBy}\nat=${new Date().toISOString()}\n`, { mode: 0o664 });
  await rename(tmp, join(d, "request"));
  return id;
}
