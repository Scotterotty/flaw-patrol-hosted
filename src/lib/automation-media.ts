import JSZip from "jszip";
import { isPlaywrightReport, type AutoTest } from "./automation";
import type { FileSettings, MediaCounts } from "./automation-files";
import { openZip, readEntry, ZIP_LIMITS, zipBudget, type ZipBudget } from "./zip-limits";

// Screenshots, videos and step-by-step replays from automation. An upload can be
// the results file plus Playwright's test-results folder, or one zip of both (a GitHub
// artifact is one too). This sorts the results files from the media, and finds each
// file's test: by the path the results file lists, else by Playwright's folder names.

export type MediaKind = "screenshot" | "video" | "trace";
export type Media = { path: string; kind: MediaKind; contentType: string; bytes: Uint8Array };
export type Bundle = { results: { name: string; text: string }[]; media: Media[] };

const TYPES: Record<string, [MediaKind, string]> = {
  png: ["screenshot", "image/png"],
  jpg: ["screenshot", "image/jpeg"],
  jpeg: ["screenshot", "image/jpeg"],
  gif: ["screenshot", "image/gif"],
  webp: ["screenshot", "image/webp"],
  webm: ["video", "video/webm"],
  mp4: ["video", "video/mp4"],
};

const ext = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";
const norm = (path: string) => path.replace(/\\/g, "/").replace(/^\.?\//, "");
const isResults = (name: string) => /\.(xml)$/i.test(name);

/** A Playwright replay is a zip with a .trace inside. Only the file list is read, and a huge list isn't a replay. */
async function isTrace(bytes: Uint8Array) {
  try {
    const z = await JSZip.loadAsync(bytes);
    const names = Object.keys(z.files);
    return names.length <= ZIP_LIMITS.entries && names.some((n) => /(^|\/)(\d+-)?trace\.trace$|\.trace$/.test(n));
  } catch {
    return false;
  }
}

/**
 * Sort uploaded files into results and media, opening zips (but not replays, which are zips too).
 * Zips are unpacked within ZIP_LIMITS; pass one budget to share the limits across several calls.
 */
export async function expandUpload(files: { name: string; bytes: Uint8Array }[], budget: ZipBudget = zipBudget()): Promise<Bundle> {
  const out: Bundle = { results: [], media: [] };
  const add = async (path: string, bytes: Uint8Array, depth: number) => {
    const name = norm(path);
    const e = ext(name);
    if (isResults(name)) return void out.results.push({ name: name.split("/").pop()!, text: new TextDecoder().decode(bytes) });
    if (e === "json") {
      const text = new TextDecoder().decode(bytes);
      if (isPlaywrightReport(text)) out.results.push({ name: name.split("/").pop()!, text });
      return;
    }
    if (TYPES[e]) return void out.media.push({ path: name, kind: TYPES[e][0], contentType: TYPES[e][1], bytes });
    if (e === "zip") {
      if (await isTrace(bytes)) return void out.media.push({ path: name, kind: "trace", contentType: "application/zip", bytes });
      if (depth > 1) return;
      for (const f of await openZip(bytes, name, budget)) {
        if (/(^|\/)(__MACOSX|\.)/.test(f.name)) continue;
        await add(f.name, await readEntry(f, budget), depth + 1);
      }
    }
  };
  for (const f of files) await add(f.name, f.bytes, 0);
  return out;
}

/** Which attempt made the file: Playwright puts a retry's files in a folder ending -retry1, -retry2. */
export function attemptOf(path: string) {
  const m = norm(path).match(/-retry(\d+)(\/|$)/i);
  return m ? Number(m[1]) + 1 : 1;
}

/** Lowercase words only, for comparing a test's name with Playwright's folder names. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(spec|test)\.[cm]?[jt]sx?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Each test's files. A path the results file names wins (matched on its last two parts,
 * since CI writes full paths from another machine); otherwise a Playwright folder like
 * test-results/checkout-applies-a-discount-code-chromium, or a Cypress screenshot name.
 */
export function matchMedia(tests: AutoTest[], media: Media[]) {
  const byTest = new Map<string, Media[]>();
  const used = new Set<Media>();
  const tail = (p: string) => norm(p).split("/").slice(-2).join("/").toLowerCase();
  const byTail = new Map<string, Media>();
  for (const m of media) byTail.set(tail(m.path), m);
  const give = (t: AutoTest, m: Media) => {
    if (used.has(m)) return;
    used.add(m);
    byTest.set(t.id, [...(byTest.get(t.id) ?? []), m]);
  };
  for (const t of tests) for (const a of t.attachments ?? []) {
    const m = byTail.get(tail(a));
    if (m) give(t, m);
  }
  const left = media.filter((m) => !used.has(m));
  if (left.length) {
    // Longest names first, so "adds an item twice" doesn't take "adds an item"'s files.
    const named = tests
      .map((t) => ({ t, s: [slug(t.className), slug(t.name)].filter(Boolean).join("-"), n: slug(t.name) }))
      .filter((x) => x.n.length > 3)
      .sort((a, b) => b.s.length - a.s.length);
    for (const m of left) {
      const parts = norm(m.path).toLowerCase().split("/");
      const folder = slug(parts.at(-2) ?? "");
      const file = slug(parts.at(-1)!.replace(/\.[a-z0-9]+$/, ""));
      // Playwright cuts long folder names and adds a hash, so compare the start.
      const hit = named.find((x) => (folder.length > 8 && (x.s.startsWith(folder.slice(0, 40)) || folder.startsWith(x.s.slice(0, 40)) || folder.includes(x.n.slice(0, 40)))) || file.includes(x.n));
      if (hit) give(hit.t, m);
    }
  }
  return { byTest, unmatched: media.filter((m) => !used.has(m)).length };
}

export function countMedia(media: Media[]): MediaCounts {
  return {
    screenshots: media.filter((m) => m.kind === "screenshot").length,
    videos: media.filter((m) => m.kind === "video").length,
    replays: media.filter((m) => m.kind === "trace").length,
    bytes: media.reduce((n, m) => n + m.bytes.length, 0),
  };
}

/** The files kept for one test under the umbrella's rules: failed and flaky only, and none over the size cap. */
export function keptFor(t: AutoTest, files: Media[], s: FileSettings) {
  if (s.keep === "failed" && t.status !== "FAILED" && !t.retried) return [];
  return files.filter((m) => m.bytes.length <= s.maxMb * 1024 * 1024);
}
