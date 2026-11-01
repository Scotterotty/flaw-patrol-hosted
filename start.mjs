// One-step local start without Docker: `node start.mjs`.
// First run asks for a Postgres connection string (for example a free Neon
// database), writes .env, installs packages and sets up the database.
// `node start.mjs --fast` (ver_129) builds the app once (a couple of minutes, and
// again only when the code changes), then runs the finished build, so pages open
// quickly instead of being built on your first visit to each.
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`This needs Node 22 (you have ${process.versions.node}). Get it from https://nodejs.org`);
  process.exit(1);
}

const run = (cmd, env) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

if (!existsSync(".env") || !/DATABASE_URL="?postgres/.test(readFileSync(".env", "utf8"))) {
  console.log("\nPaste your Postgres connection string.");
  console.log("Free option: sign up at https://neon.tech, create a project, and copy the connection string it shows.\n");
  const rl = createInterface({ input: process.stdin });
  // One iterator for every question: breaking out of a for-await would close the input.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => {
    process.stdout.write(q);
    const { value, done } = await lines.next();
    return done ? null : value.trim();
  };
  let url = "";
  for (let q = "Connection string: "; ; q = "It should start with postgresql://\nConnection string: ") {
    const line = await ask(q);
    if (line === null) break;
    url = line.replace(/^psql\s+/, "").replace(/^['"]|['"]$/g, "");
    if (/^postgres(ql)?:\/\//.test(url)) break;
  }
  if (!/^postgres(ql)?:\/\//.test(url)) process.exit(1);
  console.log("\nIf a teammate or an older copy of Flaw Patrol already uses this database, paste its AUTH_SECRET");
  console.log("(from that copy's .env) so saved Jira tokens keep working. Leave blank to make a new one.\n");
  const secret = ((await ask("AUTH_SECRET: ")) ?? "").replace(/^AUTH_SECRET=/, "").replace(/^['"]|['"]$/g, "");
  rl.close();
  writeFileSync(
    ".env",
    [
      `DATABASE_URL="${url}"`,
      `AUTH_SECRET="${secret || randomBytes(32).toString("base64")}"`,
      `AUTH_TRUST_HOST="true"`,
      "",
    ].join("\n"),
  );
  console.log("Saved to .env\n");
}

if (!existsSync("node_modules")) {
  console.log("Installing packages (first run only)…");
  run("npm install --no-audit --no-fund");
}

console.log("Setting up the database…");
// Neon's pooled address ("-pooler") can't take the lock migrations need, so
// migrate through the direct address. The app itself is fine on either. The
// lock only guards against two people migrating at once, and a lock taken
// through the pooler can stay stuck, so skip it for this one-person setup.
const dbUrl = /DATABASE_URL="?([^"\n]+)/.exec(readFileSync(".env", "utf8"))?.[1] ?? "";
run("npx prisma migrate deploy", {
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
  ...(dbUrl.includes("-pooler.") ? { DATABASE_URL: dbUrl.replace("-pooler.", ".") } : {}),
});
if (process.argv.includes("--demo")) run("npm run db:seed");

await checkJiraTokens();

if (process.argv.includes("--fast")) {
  // Build again only when the code changed since the last fast start.
  const stamp = codeStamp();
  const stampFile = join(".next", "flaw-patrol-build");
  const built = existsSync(join(".next", "BUILD_ID")) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp;
  if (!built) {
    console.log("\nBuilding the app (first fast start after an update, takes a few minutes)…\n");
    // A dev-mode .next folder trips up the build, so start clean.
    rmSync(".next", { recursive: true, force: true });
    run("npx next build", { FP_PLAIN_BUILD: "1" });
    writeFileSync(stampFile, stamp);
  }
  console.log("\nStarting. Open http://localhost:3000 when it says Ready. Press Ctrl+C to stop.\n");
  run("npx next start -p 3000", { FP_PLAIN_BUILD: "1" });
} else {
  // next dev can't use the finished build a fast start left behind.
  if (existsSync(join(".next", "BUILD_ID"))) rmSync(".next", { recursive: true, force: true });
  console.log("\nStarting. Open http://localhost:3000 when it says Ready. Press Ctrl+C to stop.");
  console.log("Tip: node start.mjs --fast opens pages faster (it builds the app once first).\n");
  run("npx next dev -p 3000");
}

/** A fingerprint of the app's code: every file's path, size and change time under the folders a build uses. */
function codeStamp() {
  const h = createHash("sha256");
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(`${p}:${st.size}:${st.mtimeMs}\n`);
    }
  };
  for (const f of ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", ".env"]) if (existsSync(f)) h.update(`${f}:${statSync(f).mtimeMs}\n`);
  for (const d of ["src", "public", "prisma"]) walk(d);
  return h.digest("hex");
}

// Jira API tokens are sealed with AUTH_SECRET (src/lib/crypto.ts). Warn when
// this copy's secret can't open them, which happens when the .env was recreated
// or another copy with its own secret saved the token.
async function checkJiraTokens() {
  try {
    const env = readFileSync(".env", "utf8");
    const secret = /AUTH_SECRET="?([^"\n]+)/.exec(env)?.[1];
    const { PrismaClient } = await import("@prisma/client");
    const { createDecipheriv, createHash } = await import("node:crypto");
    const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const rows = await db.jiraConfig.findMany({ select: { tokenEncrypted: true, project: { select: { name: true } } } });
    await db.$disconnect();
    const key = createHash("sha256").update(`secret-box:${secret}`).digest();
    const bad = rows.filter((r) => {
      try {
        const [, iv, tag, data] = r.tokenEncrypted.split(".");
        const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
        d.setAuthTag(Buffer.from(tag, "base64"));
        Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]);
        return false;
      } catch {
        return true;
      }
    });
    if (bad.length) {
      console.log(`\n⚠  The saved Jira API token for ${bad.map((r) => r.project.name).join(", ")} can't be read with this copy's AUTH_SECRET.`);
      console.log("   Copy AUTH_SECRET from the .env that saved it (your previous version's folder), or paste the token again in the project's Settings → Jira.\n");
    }
  } catch {
    // Only a hint; never block starting.
  }
}
