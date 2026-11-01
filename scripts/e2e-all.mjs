// The whole end-to-end run in one command (`npm run e2e:all`):
//   1. the preflight (scripts/e2e-preflight.mjs), which stops early if setup is wrong
//   2. every spec on the production build, stopping after 15 failures (a run that's failing that much is a setup problem)
//   3. the Umbrellas page card check (ver_100) on the database the specs just filled
//   4. the specs that need next dev (DEV_ONLY in playwright.config.ts)
// Pass --no-build to reuse the last production build. Prints how long each part took.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { freePorts, root } from "./e2e-preflight.mjs";

// Same list as DEV_ONLY in playwright.config.ts.
const DEV_ONLY = ["run-sheet.spec.ts", "ver82.spec.ts"];
const times = [];

function part(name, cmd, args, env = {}) {
  const t = Date.now();
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" });
  times.push(`${name}: ${Math.round((Date.now() - t) / 60000)} min, ${r.status === 0 ? "passed" : "FAILED"}`);
  return r.status === 0;
}

const pre = part("Preflight", process.execPath, [join(root, "scripts", "e2e-preflight.mjs"), ...process.argv.slice(2)]);
let ok = pre;
if (pre) {
  ok = part("All specs on the production build", "npx", ["playwright", "test", "--max-failures=15"], { E2E_SERVER: "prod" }) && ok;
  await freePorts();
  // Every umbrella card the old way and the ver_100 way must match exactly.
  ok = part("Umbrella card check", "npm", ["run", "check:cards"], { DATABASE_URL: readFileSync(join(root, ".e2e-database"), "utf8").trim() }) && ok;
  // Everyone's mini game XP the old way and the ver_120 way must match exactly.
  ok = part("Mini game XP check", "npm", ["run", "check:xp"], { DATABASE_URL: readFileSync(join(root, ".e2e-database"), "utf8").trim() }) && ok;
  // Test runs New/Updated counts the old way and the ver_129 way must match exactly.
  ok = part("Test runs New/Updated check", "npm", ["run", "check:news"], { DATABASE_URL: readFileSync(join(root, ".e2e-database"), "utf8").trim() }) && ok;
  // Everyone's crowns the old way and the ver_129 way must match exactly.
  ok = part("Mini game crowns check", "npm", ["run", "check:crowns"], { DATABASE_URL: readFileSync(join(root, ".e2e-database"), "utf8").trim() }) && ok;
  // next dev can't share the production build's .next folder.
  rmSync(join(root, ".next"), { recursive: true, force: true });
  ok = part("Specs that need next dev", "npx", ["playwright", "test", ...DEV_ONLY], { E2E_SERVER: "dev" }) && ok;
  await freePorts();
}

console.log(`\n${times.join("\n")}\n${ok ? "✓ Every end-to-end test passed." : "✗ Some tests failed; see above (npx playwright show-report for details)."}`);
process.exit(ok ? 0 : 1);
