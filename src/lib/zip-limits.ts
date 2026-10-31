import JSZip from "jszip";

// Limits for unzipping uploads, so a small zip that unpacks to gigabytes (a "zip bomb")
// can't run the server out of memory. Every upload path opens zips through here:
// Upload automation results, CI uploads and Pull from GitHub.

export const ZIP_LIMITS = {
  /** Everything one upload unpacks to, across every zip inside it. */
  totalBytes: 500 * 1024 * 1024,
  /** Files in one upload, across every zip inside it. */
  entries: 5000,
  /** One file inside a zip. */
  fileBytes: 200 * 1024 * 1024,
};
export type ZipLimits = typeof ZIP_LIMITS;

/** A limit was passed; the message is shown to the person as is. */
export class ZipLimitError extends Error {}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
const base = (path: string) => path.split("/").pop() || path;

/** Running totals for one upload, shared by every zip inside it. */
export function zipBudget(limits: ZipLimits = ZIP_LIMITS) {
  return { limits, bytes: 0, entries: 0 };
}
export type ZipBudget = ReturnType<typeof zipBudget>;

/** Open a zip and count its files against the budget. Reads only the file list, nothing is unpacked yet. */
export async function openZip(bytes: Uint8Array | ArrayBuffer, name: string, budget: ZipBudget) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error(`${base(name)} isn't a zip file that can be opened.`);
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  budget.entries += files.length;
  if (budget.entries > budget.limits.entries)
    throw new ZipLimitError(`This upload has more than ${budget.limits.entries.toLocaleString("en-US")} files in its zips. Upload fewer files at a time.`);
  return files;
}

/** The size a zip says a file unpacks to. It can lie, so readEntry counts real bytes too. */
const declaredSize = (f: JSZip.JSZipObject) => (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;

// JSZip's chunked reader; it's public (jszip docs) but missing from its types.
type ChunkStream = {
  on(event: "data", cb: (chunk: Uint8Array) => void): ChunkStream;
  on(event: "error", cb: (e: Error) => void): ChunkStream;
  on(event: "end", cb: () => void): ChunkStream;
  pause(): ChunkStream;
  resume(): ChunkStream;
};
const chunksOf = (f: JSZip.JSZipObject) => (f as unknown as { internalStream(type: "uint8array"): ChunkStream }).internalStream("uint8array");

/** Unpack one file, stopping as soon as it (or the whole upload) passes a limit. */
export function readEntry(f: JSZip.JSZipObject, budget: ZipBudget): Promise<Uint8Array> {
  const { limits } = budget;
  const fileTooBig = () => new ZipLimitError(`${base(f.name)} unpacks to more than ${mb(limits.fileBytes)}. Upload fewer or smaller files.`);
  const totalTooBig = () => new ZipLimitError(`This zip unpacks to more than ${mb(limits.totalBytes)}. Upload fewer files at a time.`);
  const size = declaredSize(f);
  if (size !== undefined) {
    if (size > limits.fileBytes) return Promise.reject(fileTooBig());
    if (budget.bytes + size > limits.totalBytes) return Promise.reject(totalTooBig());
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let n = 0;
    let done = false;
    const stream = chunksOf(f);
    stream
      .on("data", (chunk: Uint8Array) => {
        if (done) return;
        n += chunk.length;
        budget.bytes += chunk.length;
        if (n > limits.fileBytes || budget.bytes > limits.totalBytes) {
          done = true;
          stream.pause();
          reject(n > limits.fileBytes ? fileTooBig() : totalTooBig());
          return;
        }
        chunks.push(chunk);
      })
      .on("error", (e: Error) => {
        if (done) return;
        done = true;
        reject(e);
      })
      .on("end", () => {
        if (done) return;
        done = true;
        const out = new Uint8Array(n);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.length;
        }
        resolve(out);
      })
      .resume();
  });
}

/**
 * Read a request body with a running byte count, stopping at maxBytes even when the
 * Content-Length header is missing or wrong. Returns null when it's too big.
 */
export async function readBody(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The form in a request, read with readBody's size cap: null when it's too big. Throws when it isn't a form. */
export async function readForm(req: Request, maxBytes: number): Promise<FormData | null> {
  const body = await readBody(req, maxBytes);
  if (!body) return null;
  return new Response(body as BodyInit, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
}
