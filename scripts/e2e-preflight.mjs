// Preflight for the end-to-end tests: a few minutes of checks that stop with a plain message,
// instead of a full run that fails everywhere hours later (what happened to ver_96's first run).
//   node scripts/e2e-preflight.mjs              everything below
//   node scripts/e2e-preflight.mjs --no-build   reuse the last production build
// Each run gets a brand-new local database (fp_e2e_<time>), named in .e2e-database, which playwright.config.ts
// picks up. Nothing in the database .env names is changed, and it refuses to run against anything but a local one.
// `npm run e2e:all` runs this first and then the full suite (scripts/e2e-all.mjs).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const root = join(import.meta.dirname, "..");
// The test server, then the stand-ins: Sentry, mail, company sign-in, GitHub, run sheet hook, Jira.
// 3000 too: a dev server there writes into the same .next folder as the test build.
export const PORTS = [3000, 3100, 3193, 3194, 3195, 3196, 3198, 3199];

const started = Date.now();
const secs = (t) => `${Math.round((Date.now() - t) / 1000)}s`;

export function stop(why, fix) {
  console.error(`\n✗ Preflight stopped: ${why}${fix ? `\n  Fix: ${fix}` : ""}`);
  process.exit(1);
}

export async function step(name, fn) {
  const t = Date.now();
  process.stdout.write(`• ${name}… `);
  const note = await fn();
  console.log(`ok (${secs(t)})${note ? `\n    ${note}` : ""}`);
}

/** Runs a command in the app folder; on failure prints its output and stops with `why`. */
export function run(cmd, args, why, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.log("\n" + `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n"));
    stop(why);
  }
  return r.stdout ?? "";
}

/** Whether anything answers on a local port. */
const inUse = (port) =>
  new Promise((resolve) => {
    const sock = connect({ port, host: "127.0.0.1" });
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });

/** Processes listening on a port. lsof misses some sockets (it did in the build sandbox), so fuser and netstat back it up. */
function listeners(port) {
  const tries =
    process.platform === "win32"
      ? [() => execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).split("\n").filter((l) => l.includes(`:${port} `) && /LISTENING/.test(l)).map((l) => l.trim().split(/\s+/).pop())]
      : [() => execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split(/\s+/), () => execFileSync("fuser", ["-n", "tcp", String(port)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\s+/)];
  for (const t of tries) {
    try {
      const pids = t().filter((p) => /^\d+$/.test(p) && Number(p) !== process.pid);
      if (pids.length) return [...new Set(pids)].map(Number);
    } catch {} // not installed, or nothing found
  }
  return [];
}

/** Closes whatever is listening on the test ports: old test servers and stand-ins left over from an earlier run. */
export async function freePorts() {
  const closed = [];
  for (const port of PORTS) {
    if (!(await inUse(port))) continue;
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      for (const pid of listeners(port)) {
        try {
          process.kill(pid, signal);
          if (signal === "SIGTERM") closed.push(`${port} (process ${pid})`);
        } catch {}
      }
      for (let i = 0; i < 20 && (await inUse(port)); i++) await new Promise((r) => setTimeout(r, 250));
      if (!(await inUse(port))) break;
    }
    if (await inUse(port)) stop(`something is still using port ${port} and it couldn't be closed.`, `close it yourself (it may be a server from an earlier test run), then run the preflight again.`);
  }
  return closed.length ? `closed ${closed.join(", ")}` : "";
}

/** Settings from .env, overridden by the real environment, the way Next and Prisma read them. */
function settings() {
  const env = {};
  const file = join(root, ".env");
  if (existsSync(file))
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  return { ...env, ...process.env };
}

async function main() {
  const reuseBuild = process.argv.includes("--no-build");
  console.log("End-to-end preflight\n");

  await step("Close old test servers and stand-ins", freePorts);

  let base;
  await step("Check settings", () => {
    const env = settings();
    base = env.DATABASE_URL;
    if (!env.DATABASE_URL) stop("DATABASE_URL isn't set.", "add it to .env (see .env.example).");
    let host;
    try {
      host = new URL(env.DATABASE_URL).hostname;
    } catch {
      stop("DATABASE_URL isn't a valid connection string.");
    }
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host))
      stop(`DATABASE_URL points at ${host}, not a local database. Test runs make their own databases, so they only run against a local Postgres.`, "point DATABASE_URL in .env at a local Postgres.");
    if (!env.AUTH_SECRET) stop("AUTH_SECRET isn't set, so nobody can sign in.", "add AUTH_SECRET to .env (any long random text for testing).");
    const browser = env.PW_CHROMIUM_PATH;
    if (browser && !existsSync(browser)) stop(`PW_CHROMIUM_PATH is ${browser}, but there's no browser there.`);
    const authUrl = env.AUTH_URL && new URL(env.AUTH_URL).port !== "3100" ? `.env has AUTH_URL=${env.AUTH_URL}; the test server overrides it with port 3100 (the smoke test checks).` : "";
    return [`database on ${host}`, authUrl].filter(Boolean).join("\n    ");
  });

  await step("Check the tests for renamed or removed buttons", () => {
    const r = spawnSync(process.execPath, [join(root, "scripts", "e2e-stale-names.mjs")], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) {
      console.log("\n" + r.stdout.trim());
      stop("some tests still use names the app no longer shows.", "update those tests to the new names (same step as the UI change), then run the preflight again.");
    }
  });

  // A brand-new database every run: leftovers from earlier testing (shared template domains, menu order,
  // appearance, quest map, sorting, What's new seen) broke ver_96 specs. This also proves every migration runs from empty.
  await step("New test database with every migration and the demo data", () => {
    const name = `fp_e2e_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
    const admin = new URL(base);
    admin.pathname = "/postgres";
    const url = new URL(base);
    url.pathname = `/${name}`;
    const r = spawnSync("npx", ["prisma", "db", "execute", "--url", admin.href, "--stdin"], { cwd: root, input: `CREATE DATABASE "${name}";`, encoding: "utf8", shell: process.platform === "win32" });
    if (r.status !== 0) {
      console.log("\n" + `${r.stdout}${r.stderr}`.trim());
      stop("couldn't make a test database. Is Postgres running and is DATABASE_URL right?");
    }
    run("npx", ["prisma", "migrate", "deploy"], "a migration failed on an empty database.", { DATABASE_URL: url.href });
    run("npm", ["run", "db:seed"], "the demo data couldn't be loaded (prisma/seed.ts failed).", { DATABASE_URL: url.href, SEED_PASSWORD: "flaw patrol e2e password" });
    writeFileSync(join(root, ".e2e-database"), url.href + "\n");
    return `${name} (saved in .e2e-database; the tests use it)`;
  });

  // The tests run on a production build: next dev compiles pages mid-test and restarts itself when memory runs low.
  await step(reuseBuild ? "Use the existing production build" : "Production build (the slow part, a few minutes)", () => {
    if (reuseBuild) {
      if (!existsSync(join(root, ".next", "BUILD_ID"))) stop("there's no production build to reuse.", "run without --no-build.");
      return;
    }
    run("npx", ["next", "build"], "the production build failed, so the app has an error to fix first.");
  });

  await step("Smoke test: sign in and open two pages", async () => {
    await freePorts();
    run("npx", ["playwright", "test", "smoke.spec.ts", "--reporter=line", "--retries=0"], "the smoke test failed, so the full run would fail everywhere. The output above says where.", { E2E_SERVER: "prod" });
    await freePorts();
  });

  console.log(`\n✓ Preflight passed in ${secs(started)}. Safe to start the full run.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
