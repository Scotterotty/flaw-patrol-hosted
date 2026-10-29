import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { mergeFiles, parseResultsFile } from "./automation";
import { keptFor, matchMedia, expandUpload } from "./automation-media";
import { DEFAULT_FILES, mediaWords, parseFileSettings } from "./automation-files";

const junit = `<testsuites><testsuite name="checkout.spec.ts">
<testcase name="Checkout › applies a discount code" classname="checkout.spec.ts" time="4.2">
<failure message="checkout.spec.ts:41:5 applies a discount code" type="FAILURE">Expected "$45.00"</failure>
<system-out>
[[ATTACHMENT|test-results/checkout-Checkout-applies-a-discount-code-chromium/test-failed-1.png]]

[[ATTACHMENT|test-results/checkout-Checkout-applies-a-discount-code-chromium/video.webm]]
</system-out>
</testcase>
<testcase name="Checkout › shows the cart" classname="checkout.spec.ts" time="1"/>
</testsuite></testsuites>`;

const report = JSON.stringify({
  config: { metadata: { build: "1187" } },
  stats: { duration: 12000 },
  suites: [
    {
      title: "search.spec.ts",
      file: "search.spec.ts",
      specs: [],
      suites: [
        {
          title: "Search",
          file: "search.spec.ts",
          specs: [
            {
              title: "shows results while typing",
              file: "search.spec.ts",
              tests: [
                {
                  projectName: "chromium",
                  status: "flaky",
                  results: [
                    { status: "failed", duration: 900, error: { message: "\u001b[31mTimeout\u001b[39m" }, attachments: [{ name: "trace", contentType: "application/zip", path: "/home/runner/work/x/test-results/search-Search-shows-results-chromium/trace.zip" }], steps: [{ title: "Type milk", category: "test.step", duration: 300 }, { title: "Check results", category: "test.step", duration: 600, error: {} }] },
                    { status: "passed", duration: 800, attachments: [], steps: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("Playwright results (ver_93)", () => {
  it("reads JUnit [[ATTACHMENT]] lines and leaves them out of the console output", () => {
    const f = parseResultsFile(junit);
    expect(f.tests[0].id).toBe("checkout.spec.ts.Checkout › applies a discount code");
    expect(f.tests[0].attachments).toHaveLength(2);
    expect(f.tests[0].output).toBe("");
  });

  it("reads the JSON report: names like JUnit, steps, retries and attachments", () => {
    const f = parseResultsFile(report, "results.json");
    expect(f.format).toBe("playwright");
    expect(f.build).toBe("1187");
    const t = f.tests[0];
    expect(t.id).toBe("search.spec.ts.Search › shows results while typing");
    expect(t.status).toBe("PASSED");
    expect(t.retried).toBe(1);
    expect(t.steps).toEqual([
      { title: "Type milk", ok: true, ms: 300 },
      { title: "Check results", ok: false, ms: 600 },
    ]);
    expect(t.attachments?.[0]).toMatch(/trace\.zip$/);
  });

  it("matches files by the listed path, else by Playwright's folder name", () => {
    const { tests } = mergeFiles([{ name: "results.xml", text: junit }]);
    const png = { path: "pw/test-results/checkout-Checkout-applies-a-discount-code-chromium/test-failed-1.png", kind: "screenshot" as const, contentType: "image/png", bytes: new Uint8Array(10) };
    const stray = { path: "test-results/checkout-Checkout-applies-a-discount-code-chromium/trace.zip", kind: "trace" as const, contentType: "application/zip", bytes: new Uint8Array(10) };
    const other = { path: "test-results/nothing-like-it/test-failed-1.png", kind: "screenshot" as const, contentType: "image/png", bytes: new Uint8Array(10) };
    const { byTest, unmatched } = matchMedia(tests, [png, stray, other]);
    expect(byTest.get(tests[0].id)).toEqual([png, stray]);
    expect(unmatched).toBe(1);
  });

  it("keeps files only for failed and flaky tests, under the size cap", () => {
    const { tests } = mergeFiles([{ name: "results.xml", text: junit }]);
    const big = { path: "a.webm", kind: "video" as const, contentType: "video/webm", bytes: new Uint8Array(60 * 1024 * 1024) };
    const small = { path: "a.png", kind: "screenshot" as const, contentType: "image/png", bytes: new Uint8Array(5) };
    expect(keptFor(tests[0], [big, small], DEFAULT_FILES)).toEqual([small]);
    expect(keptFor(tests[1], [small], DEFAULT_FILES)).toEqual([]);
    expect(keptFor(tests[1], [small], { keep: "all", maxMb: 100 })).toEqual([small]);
    expect(parseFileSettings({ keep: "nope", maxMb: 7 })).toEqual(DEFAULT_FILES);
    expect(mediaWords({ screenshots: 5, videos: 1, replays: 0 })).toBe("5 screenshots, 1 video");
  });

  it("opens a zip of results and test-results, keeping replay zips whole", async () => {
    const trace = new JSZip();
    trace.file("trace.trace", "{}");
    const zip = new JSZip();
    zip.file("results.xml", junit);
    zip.file("test-results/x/test-failed-1.png", new Uint8Array([1, 2]));
    zip.file("test-results/x/trace.zip", await trace.generateAsync({ type: "uint8array" }));
    zip.file("__MACOSX/._results.xml", "junk");
    const b = await expandUpload([{ name: "playwright-results-1187.zip", bytes: await zip.generateAsync({ type: "uint8array" }) }]);
    expect(b.results.map((r) => r.name)).toEqual(["results.xml"]);
    expect(b.media.map((m) => m.kind).sort()).toEqual(["screenshot", "trace"]);
  });
});
