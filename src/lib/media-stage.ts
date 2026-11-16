import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Media } from "./automation-media";

// Screenshots, videos and replays wait here between dropping a zip or pulling a
// GitHub run and pressing Save, so the browser doesn't send them twice. One folder per
// upload on the server's own disk, cleared after a day.

const ROOT = join(tmpdir(), "flaw-patrol-media");
const DAY = 24 * 60 * 60 * 1000;
type Manifest = { userId: string; files: { path: string; kind: Media["kind"]; contentType: string }[] };

// Hosted build (backend review: "Upload DoS"): the staging folder has room for STAGE_LIMIT_MB
// (default 1024; the Kubernetes /tmp holds 2 GiB) and each person keeps their latest
// PER_PERSON uploads. When it's full, the oldest waiting uploads make room.
const PER_PERSON = 3;
const stageLimit = () => {
  const mb = Number(process.env.STAGE_LIMIT_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 1024) * 1024 * 1024;
};

type Staged = { id: string; at: number; bytes: number; userId: string | null };

async function staged(): Promise<Staged[]> {
  const out: Staged[] = [];
  for (const id of await readdir(ROOT).catch(() => [] as string[])) {
    const dir = join(ROOT, id);
    const s = await stat(dir).catch(() => null);
    if (!s) continue;
    let bytes = 0;
    for (const f of await readdir(dir).catch(() => [] as string[])) bytes += (await stat(join(dir, f)).catch(() => null))?.size ?? 0;
    const manifest = await readFile(join(dir, "manifest.json"), "utf8").then((t) => JSON.parse(t) as Manifest, () => null);
    out.push({ id, at: s.mtimeMs, bytes, userId: manifest?.userId ?? null });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Clears day-old uploads, then makes room for `incoming` bytes from `userId`. */
async function sweep(userId: string, incoming: number) {
  const drop = (id: string) => rm(join(ROOT, id), { recursive: true, force: true });
  let all = await staged();
  for (const d of all.filter((d) => Date.now() - d.at > DAY)) await drop(d.id);
  all = all.filter((d) => Date.now() - d.at <= DAY);
  const mine = all.filter((d) => d.userId === userId);
  for (const d of mine.slice(0, Math.max(0, mine.length - (PER_PERSON - 1)))) {
    await drop(d.id);
    all = all.filter((x) => x.id !== d.id);
  }
  let total = all.reduce((n, d) => n + d.bytes, 0);
  for (const d of all) {
    if (total + incoming <= stageLimit()) break;
    await drop(d.id);
    total -= d.bytes;
  }
}

export async function stageMedia(media: Media[], userId: string) {
  if (!media.length) return null;
  await sweep(userId, media.reduce((n, m) => n + m.bytes.length, 0));
  const id = randomBytes(12).toString("hex");
  const dir = join(ROOT, id);
  await mkdir(dir, { recursive: true });
  const manifest: Manifest = { userId, files: [] };
  for (const [i, m] of media.entries()) {
    await writeFile(join(dir, String(i)), m.bytes);
    manifest.files.push({ path: m.path, kind: m.kind, contentType: m.contentType });
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  return id;
}

/** The staged files, only for whoever staged them (or a CI token's owner). Empty when gone. */
export async function loadStage(id: string | undefined | null, userId: string | null): Promise<Media[]> {
  if (!id || !/^[0-9a-f]{24}$/.test(id)) return [];
  const dir = join(ROOT, id);
  try {
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifest;
    if (userId && manifest.userId !== userId) return [];
    return await Promise.all(manifest.files.map(async (f, i) => ({ ...f, bytes: new Uint8Array(await readFile(join(dir, String(i)))) })));
  } catch {
    return [];
  }
}

export async function dropStage(id: string | undefined | null) {
  if (id && /^[0-9a-f]{24}$/.test(id)) await rm(join(ROOT, id), { recursive: true, force: true });
}
