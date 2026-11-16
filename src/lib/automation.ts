import { XMLParser } from "fast-xml-parser";

// Automation results: read the JUnit XML most test tools and CI servers write,
// and the NUnit XML (2 and 3) that .NET and Unity test runners write.

export type AutoStatus = "PASSED" | "FAILED" | "SKIPPED";
export type AutoTest = {
  /** classname.name: what a case's Automation ID holds. */
  id: string;
  className: string;
  name: string;
  status: AutoStatus;
  /** A test that errored or crashed (not an assertion), saved as Failed with "Crashed" on top. */
  crashed: boolean;
  message: string;
  stack: string;
  output: string;
  durationMs: number | null;
  /** Screenshots, videos and replays the file points at: JUnit [[ATTACHMENT|path]] lines or the JSON report. */
  attachments?: string[];
  /** What the test did: its test.step() lines, from Playwright's JSON report. */
  steps?: TestStep[];
  /** Playwright's own test.step() titles, which become the case's steps. */
  caseSteps?: string[];
  /** Failed this many times before passing on a retry. */
  retried?: number;
};
export type TestStep = { title: string; ok: boolean; ms: number | null };
export type AutoFile = { format: "junit" | "nunit" | "playwright"; tests: AutoTest[]; build: string; durationSec: number | null };

const LIMIT = 20_000;
const clip = (s: string) => (s.length > LIMIT ? `${s.slice(0, LIMIT)}\n… (cut at ${LIMIT} characters)` : s);

type Node = Record<string, unknown>;
const arr = (v: unknown): Node[] => (v == null ? [] : Array.isArray(v) ? (v as Node[]) : [v as Node]);
function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join("\n");
  const n = v as Node;
  return text(n["#text"]);
}
const attr = (n: Node, k: string) => (n[k] == null ? "" : String(n[k]));
const seconds = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * JUnit reports never declare a DOCTYPE. Taking it out means no custom entities can be
 * defined, so an uploaded report can't expand into gigabytes (hosted build, backend team
 * review: XML entities). The standard ones (&amp; &lt; and so on) still read as before.
 */
export function withoutDoctype(xml: string) {
  return xml.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, "").replace(/<!ENTITY[\s\S]*?>/gi, "");
}

function parser() {
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "#text", parseAttributeValue: false, parseTagValue: false, trimValues: false, processEntities: true });
}

/** Every node with this tag, anywhere below. */
function findAll(n: unknown, tag: string, out: Node[] = []): Node[] {
  if (!n || typeof n !== "object") return out;
  if (Array.isArray(n)) {
    for (const x of n) findAll(x, tag, out);
    return out;
  }
  for (const [k, v] of Object.entries(n as Node)) {
    if (k === tag) out.push(...arr(v));
    if (typeof v === "object") findAll(v, tag, out);
  }
  return out;
}

/** A build number from the file's properties, else from its name ("TestResults-4812.xml"). */
function buildOf(root: unknown, fileName: string) {
  for (const p of findAll(root, "property")) if (/^(build|build[._-]?number|buildnumber|build\.number)$/i.test(attr(p, "name"))) return attr(p, "value").trim();
  return fileName.match(/(\d{2,})(?!.*\d)/)?.[1] ?? "";
}

function junitCase(c: Node): AutoTest {
  const className = attr(c, "classname");
  const name = attr(c, "name");
  const failure = arr(c.failure)[0];
  const error = arr(c.error)[0];
  const skipped = c.skipped !== undefined;
  const bad = failure ?? error;
  // Playwright's JUnit reporter lists each file it kept as [[ATTACHMENT|path]] in system-out.
  const attachments: string[] = [];
  const out = text(c["system-out"]).replace(/\[\[ATTACHMENT\|([^\]]+)\]\]/g, (_, path: string) => (attachments.push(path.trim()), ""));
  const output = [out.replace(/\n{3,}/g, "\n\n").trim(), text(c["system-err"])].filter(Boolean).join("\n");
  return {
    id: className && !name.startsWith(`${className}.`) ? `${className}.${name}` : name,
    className,
    name,
    status: bad ? "FAILED" : skipped ? "SKIPPED" : "PASSED",
    crashed: !failure && !!error,
    message: clip(bad ? attr(bad, "message") || text(bad).split("\n")[0] : skipped ? attr(arr(c.skipped)[0] ?? {}, "message") : ""),
    stack: clip(bad ? text(bad) : ""),
    output: clip(output),
    durationMs: seconds(attr(c, "time")) == null ? null : Math.round(seconds(attr(c, "time"))! * 1000),
    ...(attachments.length && { attachments }),
  };
}

function nunitCase(c: Node, v3: boolean): AutoTest {
  const full = attr(c, "fullname") || attr(c, "name");
  const methodName = attr(c, "methodname") || attr(c, "name");
  const className = attr(c, "classname") || (full.includes(".") ? full.slice(0, full.lastIndexOf(".")) : "");
  const result = attr(c, "result").toLowerCase();
  const failure = arr(c.failure)[0];
  const reason = arr(c.reason)[0];
  const label = attr(c, "label").toLowerCase();
  let status: AutoStatus;
  if (v3) status = result === "passed" ? "PASSED" : result === "failed" ? "FAILED" : "SKIPPED";
  else status = result === "success" ? "PASSED" : result === "failure" || result === "error" ? "FAILED" : attr(c, "executed").toLowerCase() === "false" || result === "ignored" || result === "notrunnable" || result === "inconclusive" ? "SKIPPED" : attr(c, "success").toLowerCase() === "true" ? "PASSED" : "FAILED";
  const crashed = status === "FAILED" && (label === "error" || label === "crashed" || label === "invalid" || result === "error");
  const msgNode = failure ?? reason;
  const durationSec = v3 ? seconds(attr(c, "duration")) : seconds(attr(c, "time"));
  return {
    id: full,
    className,
    name: methodName,
    status,
    crashed,
    message: clip(msgNode ? text(msgNode.message) : ""),
    stack: clip(failure ? text(failure["stack-trace"]) : ""),
    output: clip(text(c.output)),
    durationMs: durationSec == null ? null : Math.round(durationSec * 1000),
  };
}

// Playwright's JSON report (reporter: [["json", { outputFile: "results.json" }]]), ver_93.
type PwStep = { title?: string; category?: string; duration?: number; error?: unknown; steps?: PwStep[] };
type PwResult = { status?: string; duration?: number; retry?: number; error?: { message?: string; stack?: string }; errors?: { message?: string }[]; stdout?: { text?: string }[]; stderr?: { text?: string }[]; attachments?: { name?: string; contentType?: string; path?: string }[]; steps?: PwStep[] };
type PwTest = { projectName?: string; status?: string; results?: PwResult[] };
type PwSpec = { title?: string; file?: string; tests?: PwTest[] };
type PwSuite = { title?: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] };

const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (s: unknown) => (typeof s === "string" ? s.replace(ANSI, "") : "");

/** True when this JSON is a Playwright report. */
export function isPlaywrightReport(json: string) {
  const head = json.slice(0, 4000);
  return /"suites"\s*:/.test(json) && /"config"\s*:/.test(head);
}

function pwSteps(steps: PwStep[] = []): TestStep[] {
  // Its own test.step() lines when it has them, else its actions and checks; hooks left out.
  const own = steps.filter((s) => s.category === "test.step");
  const list = own.length ? own : steps.filter((s) => s.category !== "hook" && !/^(Before|After) Hooks$/.test(s.title ?? "") && s.category !== "fixture");
  return list.slice(0, 100).map((s) => ({ title: plain(s.title).slice(0, 300), ok: !s.error, ms: typeof s.duration === "number" ? Math.round(s.duration) : null }));
}

function parsePlaywright(json: string, fileName: string): AutoFile {
  let root: { suites?: PwSuite[]; stats?: { duration?: number }; config?: { metadata?: Record<string, unknown> } };
  try {
    root = JSON.parse(json);
  } catch {
    throw new Error(`${fileName || "That file"} isn't readable JSON.`);
  }
  const byId = new Map<string, AutoTest>();
  const walk = (suite: PwSuite, file: string, titles: string[]) => {
    const here = suite.file && !file ? suite.file : file;
    // The file's own suite is named after the file; describe() blocks add their titles.
    const path = file ? [...titles, suite.title ?? ""].filter(Boolean) : titles;
    for (const spec of suite.specs ?? []) {
      const className = here || spec.file || "";
      const name = [...path, spec.title ?? ""].filter(Boolean).join(" \u203a ");
      const id = className ? `${className}.${name}` : name;
      for (const t of spec.tests ?? []) {
        const results = t.results ?? [];
        const last = results.at(-1);
        const bad = results.find((r) => r.status !== "passed" && r.status !== "skipped");
        const status: AutoStatus = t.status === "skipped" ? "SKIPPED" : t.status === "unexpected" ? "FAILED" : "PASSED";
        const shown = status === "FAILED" ? (bad ?? last) : last;
        const err = shown?.error ?? (status === "FAILED" ? bad?.error : undefined);
        const message = plain(err?.message ?? shown?.errors?.[0]?.message ?? "").split("\n").slice(0, 12).join("\n").trim();
        const test: AutoTest = {
          id,
          className,
          name,
          status,
          crashed: false,
          message: clip(shown?.status === "timedOut" && !message ? "Timed out" : message),
          stack: clip(plain(err?.stack ?? "")),
          output: clip([...(shown?.stdout ?? []), ...(shown?.stderr ?? [])].map((o) => plain(o.text)).join("").trim()),
          durationMs: results.length ? Math.round(results.reduce((n, r) => n + (r.duration ?? 0), 0)) : null,
          attachments: results.flatMap((r) => (r.attachments ?? []).map((a) => a.path ?? "").filter(Boolean)),
          steps: pwSteps((status === "PASSED" && bad ? bad : shown)?.steps),
          caseSteps: (last?.steps ?? []).filter((s) => s.category === "test.step").slice(0, 100).map((s) => plain(s.title).slice(0, 300)),
          retried: t.status === "flaky" ? results.filter((r) => r.status !== "passed" && r.status !== "skipped").length : 0,
        };
        // The same test in two browsers is one case: the worse result wins, files from both.
        const was = byId.get(id);
        if (!was) byId.set(id, test);
        else {
          const worse = was.status === "FAILED" ? was : test.status === "FAILED" ? test : was;
          byId.set(id, { ...worse, attachments: [...(was.attachments ?? []), ...(test.attachments ?? [])], retried: Math.max(was.retried ?? 0, test.retried ?? 0) });
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, here ?? "", path);
  };
  for (const s of root.suites ?? []) walk(s, "", []);
  const meta = root.config?.metadata ?? {};
  const build = String(meta.build ?? meta.buildNumber ?? "") || (fileName.match(/(\d{2,})(?!.*\d)/)?.[1] ?? "");
  return { format: "playwright", tests: [...byId.values()], build, durationSec: typeof root.stats?.duration === "number" ? Math.round(root.stats.duration / 1000) : null };
}

/** Read one results file. Throws a plain-words error when it isn't JUnit or NUnit XML, or a Playwright JSON report. */
export function parseResultsFile(xml: string, fileName = ""): AutoFile {
  if (/^\s*[{[]/.test(xml)) {
    if (!isPlaywrightReport(xml)) throw new Error(`${fileName || "That file"} isn't a Playwright JSON report. Upload the results file your test tool writes, such as results.xml.`);
    return parsePlaywright(xml, fileName);
  }
  let root: Node;
  try {
    root = parser().parse(withoutDoctype(xml)) as Node;
  } catch {
    throw new Error(`${fileName || "That file"} isn't readable XML.`);
  }
  const nunit3 = root["test-run"];
  const nunit2 = root["test-results"];
  if (nunit3 || nunit2) {
    const cases = findAll(nunit3 ?? nunit2, "test-case");
    const top = arr(nunit3 ?? nunit2)[0] ?? {};
    return { format: "nunit", tests: cases.map((c) => nunitCase(c, !!nunit3)), build: buildOf(root, fileName), durationSec: seconds(attr(top, "duration") || attr(top, "time")) };
  }
  if (root.testsuites || root.testsuite) {
    const cases = findAll(root, "testcase");
    const top = arr(root.testsuites ?? root.testsuite)[0] ?? {};
    let durationSec = seconds(attr(top, "time"));
    if (durationSec == null) durationSec = findAll(root, "testsuite").reduce((s, x) => s + (seconds(attr(x, "time")) ?? 0), 0) || null;
    return { format: "junit", tests: cases.map(junitCase), build: buildOf(root, fileName), durationSec };
  }
  throw new Error(`${fileName || "That file"} isn't JUnit or NUnit XML. Upload the results file your test tool writes, such as TestResults.xml.`);
}

/** Several files from one build: one list, later files win for a test that shows up twice. */
export function mergeFiles(files: { name: string; text: string }[]) {
  const byId = new Map<string, AutoTest>();
  let build = "";
  let durationSec = 0;
  let timed = false;
  for (const f of files) {
    const parsed = parseResultsFile(f.text, f.name);
    for (const t of parsed.tests) {
      // JUnit and JSON report from one Playwright run: keep the JSON's steps and retries too.
      const was = byId.get(t.id);
      byId.set(t.id, was ? { ...t, attachments: [...new Set([...(was.attachments ?? []), ...(t.attachments ?? [])])], steps: t.steps?.length ? t.steps : was.steps, retried: t.retried || was.retried } : t);
    }
    build ||= parsed.build;
    if (parsed.durationSec != null) {
      durationSec += parsed.durationSec;
      timed = true;
    }
  }
  return { tests: [...byId.values()], build, durationSec: timed ? Math.round(durationSec) : null };
}

/** Case keys in a test's name: ABC_12_AddItem or "ABC-12 adds an item" → ABC-12. */
export function keysInName(name: string, projectKeys: string[]): string[] {
  const keys = new Set(projectKeys.map((k) => k.toUpperCase()));
  const out: string[] = [];
  for (const m of name.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})[-_](\d{1,6})(?![0-9])/g)) {
    const k = m[1].toUpperCase();
    if (keys.has(k)) out.push(`${k}-${Number(m[2])}`);
  }
  return out;
}

/** A readable case title from a test name: "ABC_12_AddItemToCart" → "Add item to cart". */
export function titleFromTest(name: string) {
  // "Shop › adds an item" is "Adds an item": the describe() path is the folder.
  const bare = (name.split(" \u203a ").pop() ?? name).replace(/^[A-Za-z][A-Za-z0-9]{1,9}[-_]\d+[-_ ]*/, "").replace(/\(.*\)$/, "");
  // Words in capitals (GET, API, iOS-style mixes aside) keep them.
  const words = bare
    .replace(/[_.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/(\s+)/)
    .map((w) => (/^[A-Z][A-Z0-9]+$/.test(w) ? w : w.toLowerCase()))
    .join("");
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

/** Titles that say the same thing: "Pay with card" and "pay_with_card". */
export const sameTitle = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return n(a) !== "" && n(a) === n(b);
};

/**
 * Titles that are nearly the same: case and simple endings don't count, and a
 * leading "sign"/"signs"/"should" is skipped, so "Signs in with SSO" is near "Sign in with SSO"
 * and "Adds items to cart" near "Add item to cart". Only ever offered as "Looks like", never linked on its own.
 */
export const nearTitle = (a: string, b: string) => {
  const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w.length > 3 ? w.replace(/s$/, "") : w);
  const n = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .filter((w, i) => !(i === 0 && w === "should"))
      .map((w) => (w === "signs" ? "sign" : stem(w)))
      .join(" ");
  return n(a) !== "" && n(a) === n(b);
};

/**
 * A readable folder for a test class, under Automation: "checkout.CartTest" → "Cart",
 * "src/cart.test.js" → "Cart", "CheckoutFlowSpec" → "Checkout flow".
 */
export function folderFromClass(className: string) {
  const parts = className
    .split(/[./\\]/)
    .map((p) => p.replace(/(?:Tests?|Specs?|Suite|IT)$/, "").replace(/^Tests?(?=[A-Z_])/, ""))
    .filter((p) => p && !/^(test|tests|spec|specs|js|ts|jsx|tsx|mjs|cjs|py|cs|java|kt|src)$/i.test(p));
  const last = parts.at(-1) ?? "";
  // A plain lowercase name is capitalized since ver_95, like folders people make:
  // "shop" is "Shop", and a short one like "api" reads as "API".
  if (/^[a-z0-9-]+$/.test(last)) return (last.length <= 3 ? last.toUpperCase() : last[0].toUpperCase() + last.slice(1)).slice(0, 120);
  return last ? titleFromTest(last).slice(0, 120) : "";
}
