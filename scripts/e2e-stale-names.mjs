// Finds button, link and label names in the end-to-end tests that the app showed at the last commit
// (the last build) but doesn't any more. A renamed button (ver_96: Start session → Start exploring)
// otherwise only shows up as a slow timeout deep into a full test run.
// Run on its own with `node scripts/e2e-stale-names.mjs [git ref]`; the preflight runs it too.
// Exits 1 when it finds any. Names the app builds from data ("Start RC7") are in neither copy and are left alone.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");

function files(dir, ok) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ok));
    else if (ok(name)) out.push(p);
  }
  return out;
}

// Everything the app can put on screen: source plus the What's new text. Quotes and spacing vary, so
// compare on a flattened copy (HTML entities, curly quotes and line breaks evened out).
const flat = (s) =>
  s
    .replace(/&apos;|&#39;|’|‘/g, "'")
    .replace(/&quot;|“|”/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;| /g, " ")
    .replace(/\{" "\}/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
const source = (dir) => flat(files(dir, (n) => /\.(tsx?|mjs|json|md)$/.test(n)).map((f) => readFileSync(f, "utf8")).join("\n"));
const now = source(join(root, "src"));

// The app as it was at the last commit.
const ref = process.argv[2] ?? "HEAD";
let before;
const tmp = mkdtempSync(join(tmpdir(), "fp-names-"));
try {
  const tar = execFileSync("git", ["archive", "--format=tar", ref, "src"], { cwd: root, maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", tmp], { input: tar });
  before = source(join(tmp, "src"));
} catch {
  console.log(`Skipped the renamed-names check: no git history to compare with (${ref}).`);
  process.exit(0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Names often hold a number or a name the app fills in ("Step 2 status", "Picked up where {who} left off"),
// so a gap may stand in for numbers, quoted words, or one run of up to 3 words. What's left on either side
// of a word gap has to be two words or more, so a renamed "Start session" still counts as missing.
function inApp(app, wanted) {
  const has = (piece) => !piece.trim() || app.includes(piece.trim());
  const w = flat(wanted);
  if (app.includes(w)) return true;
  const fixed = w.split(/\d+(?:[.,:]\d+)*%?|"[^"]*"/);
  if (fixed.length > 1 && fixed.every(has)) return true;
  const words = w.split(" ");
  const long = (ws) => ws.length === 0 || ws.length >= 2;
  for (let i = 0; i < words.length; i++)
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const before = words.slice(0, i), after = words.slice(i + n);
      if (!before.length && !after.length) continue;
      if (long(before) && long(after) && has(before.join(" ")) && has(after.join(" "))) return true;
    }
  return false;
}

// Locators whose first argument is a plain string the app has to show.
const LOCATOR = /getBy(Role|Label|Text|Placeholder|Title)\(\s*(?:"([^"]+)"|'([^']+)')(?:\s*,\s*\{([^}]*)\})?/g;
const NAME = /name:\s*(?:"([^"]+)"|'([^']+)')/;

const missing = [];
for (const spec of files(join(root, "tests", "e2e"), (n) => /\.spec\.ts$/.test(n))) {
  const text = readFileSync(spec, "utf8");
  for (const m of text.matchAll(LOCATOR)) {
    const [, kind, a, b, opts = ""] = m;
    // getByRole("button", { name: "Save" }) checks the name; the others check their first argument.
    const wanted = kind === "Role" ? (opts.match(NAME)?.[1] ?? opts.match(NAME)?.[2]) : (a ?? b);
    if (!wanted || wanted.length < 3) continue;
    if (inApp(now, wanted) || !inApp(before, wanted)) continue;
    // Text the test made up itself (a case title it typed, a project name) isn't the app's to show.
    if (text.split(wanted).length > 2) continue;
    const line = text.slice(0, m.index).split("\n").length;
    missing.push(`${relative(root, spec)}:${line}  ${kind === "Role" ? `${a ?? b} "${wanted}"` : `${kind.toLowerCase()} "${wanted}"`}`);
  }
}

if (missing.length) {
  console.log(`These names in the tests were in the app at ${ref} but aren't any more. Update the tests to the new names:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log(`No button, link or label the tests use was renamed or removed since ${ref}.`);
