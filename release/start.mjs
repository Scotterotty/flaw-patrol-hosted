// Flaw Patrol, ready-to-run build. Start it with: node start.mjs
// The first run asks for a Postgres connection string (for example a free Neon
// database) and writes .env in the folder above this one, so every version
// unzipped beside it shares the same settings. A .env inside this folder wins
// if there is one. Every run brings the database up to date, then starts the
// app at http://localhost:3000.
import { spawn } from "node:child_process";
import { createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
process.chdir(here);

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`This needs Node 22 or newer (you have ${process.versions.node}). Get it from https://nodejs.org`);
  process.exit(1);
}

const usable = (f) => existsSync(f) && /DATABASE_URL="?postgres/.test(readFileSync(f, "utf8"));
// Windows' Extract All nests the build (FlawPatrol\Flaw_Patrol_ver_51\Flaw_Patrol),
// so look one and two folders up, and save above any folder named for a version.
const wrapper = (d) => /^Flaw_Patrol(_ver_\d+)?$/i.test(basename(d));
const up = resolve("..");
const shared = join(wrapper(up) ? resolve("../..") : up, ".env");
let envFile = [".env", resolve("../.env"), resolve("../../.env")].find(usable);
if (!envFile) envFile = (await adoptOlderEnv()) ?? (await firstRun());
console.log(`Using settings from ${resolve(envFile)}`);

const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const dbUrl = env.DATABASE_URL;

console.log("Setting up the database…");
const { PrismaClient } = await import("@prisma/client");
// Neon's pooled address ("-pooler") can't run schema changes reliably, so use the direct address for them.
const db = new PrismaClient({ datasources: { db: { url: dbUrl.replace("-pooler.", ".") } } });
try {
  await migrate(db);
  await checkJiraTokens(db, env.AUTH_SECRET);
} catch (e) {
  console.error(`\nCouldn't set up the database: ${e.message ?? e}`);
  process.exit(1);
} finally {
  await db.$disconnect();
}

const port = env.PORT || "3000";
console.log(`\nStarting. Open http://localhost:${port} when it says Ready. Press Ctrl+C to stop.\n`);
const server = spawn(process.execPath, ["server.js"], {
  stdio: "inherit",
  env: { ...process.env, AUTH_TRUST_HOST: "true", ...env, PORT: port, NODE_ENV: "production" },
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));

/**
 * Upgrading from version 50 or older, the .env sits inside the previous
 * version's folder. Offer to copy the newest one up to the shared place.
 */
async function adoptOlderEnv() {
  const top = dirname(shared);
  let found = [];
  try {
    for (const d of readdirSync(top, { withFileTypes: true })) {
      if (!d.isDirectory() || resolve(top, d.name) === here) continue;
      for (const f of [join(top, d.name, ".env"), join(top, d.name, "Flaw_Patrol", ".env")]) if (usable(f) && !f.startsWith(here)) found.push(f);
    }
  } catch {
    return null;
  }
  if (!found.length) return null;
  found = found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  console.log(`\nFound settings from an older version:\n  ${found[0]}`);
  console.log(`Copy them to ${shared} so this and every later version use them? [Y/n]`);
  const rl = createInterface({ input: process.stdin });
  const answer = (await rl[Symbol.asyncIterator]().next()).value?.trim().toLowerCase() ?? "";
  rl.close();
  if (answer.startsWith("n")) return null;
  try {
    copyFileSync(found[0], shared);
    console.log(`Copied to ${shared}\n`);
    return shared;
  } catch {
    console.log("Couldn't write there, so using the older copy where it is.\n");
    return found[0];
  }
}

async function firstRun() {
  console.log("\nPaste your Postgres connection string.");
  console.log("Free option: sign up at https://neon.tech, create a project, and copy the connection string it shows.\n");
  const rl = createInterface({ input: process.stdin });
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
  const text = [`DATABASE_URL="${url}"`, `AUTH_SECRET="${secret || randomBytes(32).toString("base64")}"`, `AUTH_TRUST_HOST="true"`, ""].join("\n");
  // Saved one folder up so the next version you unzip beside this one finds it.
  for (const f of [shared, ".env"]) {
    try {
      writeFileSync(f, text, { flag: "wx" });
      console.log(`Saved to ${resolve(f)}\n`);
      return f;
    } catch {
      // Already there (but unusable) or not writable: try the next place.
    }
  }
  writeFileSync(".env", text);
  console.log(`Saved to ${resolve(".env")}\n`);
  return ".env";
}

/**
 * Apply the schema changes in prisma/migrations that this database hasn't had
 * yet. Bookkeeping uses Prisma's own _prisma_migrations table, so this build
 * and a source copy can share one database.
 */
async function migrate(db) {
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
  const rows = await db.$queryRawUnsafe(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`);
  const failed = rows.find((r) => !r.finished_at && !r.rolled_back_at);
  if (failed) throw new Error(`An earlier database update (${failed.migration_name}) didn't finish. Ask for help before starting again.`);
  const done = new Set(rows.filter((r) => r.finished_at).map((r) => r.migration_name));
  const dir = join("prisma", "migrations");
  const todo = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !done.has(d.name))
    .map((d) => d.name)
    .sort();
  for (const name of todo) {
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    const id = randomUUID();
    await db.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ($1, $2, $3)`, id, createHash("sha256").update(sql).digest("hex"), name);
    const statements = splitSql(sql);
    try {
      for (const s of statements) await db.$executeRawUnsafe(s);
    } catch (e) {
      await db.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET logs = $1 WHERE id = $2`, String(e.message ?? e), id);
      throw new Error(`${name}: ${e.message ?? e}`);
    }
    await db.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = $1 WHERE id = $2`, statements.length, id);
    console.log(`  applied ${name}`);
  }
  if (!todo.length) console.log("  already up to date");
}

/** Split a migration into statements at semicolons outside quotes and comments. */
function splitSql(sql) {
  const out = [];
  let cur = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      cur += "\n";
    } else if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      cur += sql.slice(i, end + 1);
      i = end;
    } else if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Jira API tokens are sealed with AUTH_SECRET. Warn when this copy's secret
// can't open them, which happens when .env was recreated with a new secret.
async function checkJiraTokens(db, secret) {
  try {
    const rows = await db.$queryRawUnsafe(`SELECT j."tokenEncrypted" AS token, p.name FROM "JiraConfig" j JOIN "Project" p ON p.id = j."projectId"`);
    const key = createHash("sha256").update(`secret-box:${secret}`).digest();
    const bad = rows.filter((r) => {
      try {
        const [, iv, tag, data] = r.token.split(".");
        const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
        d.setAuthTag(Buffer.from(tag, "base64"));
        Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]);
        return false;
      } catch {
        return true;
      }
    });
    if (bad.length) {
      console.log(`\n⚠  The saved Jira API token for ${bad.map((r) => r.name).join(", ")} can't be read with this copy's AUTH_SECRET.`);
      console.log(`   Copy AUTH_SECRET from the .env that saved it into ${resolve(envFile)}, or paste the token again in the project's Settings → Jira.\n`);
    }
  } catch {
    // Only a hint; never block starting.
  }
}
