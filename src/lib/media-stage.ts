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

async function sweep() {
  try {
    for (const d of await readdir(ROOT)) {
      const s = await stat(join(ROOT, d)).catch(() => null);
      if (s && Date.now() - s.mtimeMs > DAY) await rm(join(ROOT, d), { recursive: true, force: true });
    }
  } catch {
    // Nothing staged yet.
  }
}

export async function stageMedia(media: Media[], userId: string) {
  if (!media.length) return null;
  await sweep();
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
