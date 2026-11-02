// Copies Playwright's trace viewer (step-by-step replays open in it) from the installed
// playwright-core package into public/trace-viewer, so the minified files aren't kept in git.
// Runs after every npm install (postinstall), and before builds in start.mjs, release.mjs and
// the Dockerfile. Quiet when the copy is already current; never stops an install.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "trace-viewer");
const stamp = join(out, "README.txt");

let from, version;
try {
  const pkg = createRequire(join(root, "package.json")).resolve("playwright-core/package.json");
  version = JSON.parse(readFileSync(pkg, "utf8")).version;
  from = join(dirname(pkg), "lib", "vite", "traceViewer");
} catch {}

const note = (v) =>
  `Playwright's trace viewer (from playwright-core ${v}), copied from node_modules/playwright-core/lib/vite/traceViewer by scripts/copy-trace-viewer.mjs so step-by-step replays open inside Flaw Patrol. Not kept in git; it's copied again after npm install.\n`;

if (!from || !existsSync(join(from, "index.html"))) {
  if (!existsSync(join(out, "index.html"))) console.warn("! Trace viewer not copied: playwright-core isn't installed, so step-by-step replays won't open. Run npm install.");
} else if (!existsSync(stamp) || !readFileSync(stamp, "utf8").includes(`playwright-core ${version})`) || !existsSync(join(out, "index.html"))) {
  rmSync(out, { recursive: true, force: true });
  cpSync(from, out, { recursive: true });
  writeFileSync(stamp, note(version));
  console.log(`Trace viewer copied from playwright-core ${version}.`);
}
