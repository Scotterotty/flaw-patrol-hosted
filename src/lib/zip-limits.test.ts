import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { expandUpload } from "./automation-media";
import { openZip, readBody, readEntry, zipBudget, ZIP_LIMITS } from "./zip-limits";

// Zip bomb limits (security fix, ver_103). Small limits stand in for the real ones,
// so the tests don't need to build 500 MB of data.

const small = { totalBytes: 1000, entries: 5, fileBytes: 600 };
const zipOf = async (files: Record<string, Uint8Array | string>, compression: "DEFLATE" | "STORE" = "DEFLATE") => {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files)) z.file(name, data);
  return z.generateAsync({ type: "uint8array", compression });
};
const junit = `<testsuites><testsuite name="s"><testcase name="works" classname="a.spec.ts" time="1"/></testsuite></testsuites>`;

describe("zip limits", () => {
  it("has the planned limits", () => {
    expect(ZIP_LIMITS).toEqual({ totalBytes: 500 * 1024 * 1024, entries: 5000, fileBytes: 200 * 1024 * 1024 });
  });

  it("refuses a small zip that unpacks huge", async () => {
    // 50 MB of zeros squeezes into about 50 KB.
    const bomb = await zipOf({ "results.xml": new Uint8Array(50 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200 * 1024);
    await expect(expandUpload([{ name: "bomb.zip", bytes: bomb }], zipBudget({ ...ZIP_LIMITS, fileBytes: 10 * 1024 * 1024 }))).rejects.toThrow(/unpacks to more than 10 MB/);
  });

  it("counts real bytes, not the size the zip claims", async () => {
    const zip = await zipOf({ "a.png": new Uint8Array(900) }, "STORE");
    const budget = zipBudget(small);
    const [f] = await openZip(zip, "lie.zip", budget);
    // Pretend the zip says the file is tiny.
    (f as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize = 10;
    await expect(readEntry(f, budget)).rejects.toThrow(/a\.png unpacks to more than/);
  });

  it("refuses an upload whose files add up past the total", async () => {
    const zip = await zipOf({ "1.png": new Uint8Array(400), "2.png": new Uint8Array(400), "3.png": new Uint8Array(400) });
    await expect(expandUpload([{ name: "pics.zip", bytes: zip }], zipBudget(small))).rejects.toThrow(/This zip unpacks to more than/);
  });

  it("refuses too many files", async () => {
    const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${i}.png`, "x"]));
    await expect(expandUpload([{ name: "many.zip", bytes: await zipOf(files) }], zipBudget(small))).rejects.toThrow(/more than 5 files/);
  });

  it("counts files in nested zips against the same limits", async () => {
    const inner = await zipOf({ "1.png": "x", "2.png": "x", "3.png": "x" });
    const outer = await zipOf({ "a.png": "x", "b.png": "x", "inner.zip": inner });
    await expect(expandUpload([{ name: "outer.zip", bytes: outer }], zipBudget(small))).rejects.toThrow(/more than 5 files/);
  });

  it("still opens a normal Playwright zip", async () => {
    const trace = await zipOf({ "trace.trace": "{}", "trace.network": "{}" });
    const zip = await zipOf({
      "junit.xml": junit,
      "test-results/a-works-chromium/test-failed-1.png": new Uint8Array(100),
      "test-results/a-works-chromium/video.webm": new Uint8Array(100),
      "test-results/a-works-chromium/trace.zip": trace,
    });
    const bundle = await expandUpload([{ name: "playwright.zip", bytes: zip }]);
    expect(bundle.results.map((r) => r.name)).toEqual(["junit.xml"]);
    expect(bundle.media.map((m) => m.kind).sort()).toEqual(["screenshot", "trace", "video"]);
  });
});

describe("readBody", () => {
  const streamed = (bytes: number) =>
    new Request("http://x/upload", {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes; i += 100) c.enqueue(new Uint8Array(Math.min(100, bytes - i)));
          c.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

  it("stops at the cap even without a Content-Length", async () => {
    const req = streamed(1000);
    expect(req.headers.get("content-length")).toBeNull();
    expect(await readBody(req, 500)).toBeNull();
  });

  it("reads a body under the cap", async () => {
    expect((await readBody(streamed(400), 500))?.length).toBe(400);
  });

  it("refuses a too-big Content-Length before reading", async () => {
    expect(await readBody(new Request("http://x", { method: "POST", body: "small", headers: { "content-length": "999999" } }), 500)).toBeNull();
  });
});
