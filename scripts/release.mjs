// Builds the ready-to-run copy of Flaw Patrol into dist/Flaw_Patrol: the
// compiled app with only the packages it needs, the database engines for
// Windows, macOS and Linux, the schema changes, and a start script. No source.
// Usage: npm run release
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const out = "dist/Flaw_Patrol";
const schema = "prisma/schema.release.prisma";

// Database engines for every computer the team uses, not just this one.
writeFileSync(
  schema,
  readFileSync("prisma/schema.prisma", "utf8").replace(
    'provider = "prisma-client-js"',
    'provider = "prisma-client-js"\n  binaryTargets = ["native", "windows", "darwin", "darwin-arm64", "debian-openssl-3.0.x"]',
  ),
);
try {
  run(`npx prisma generate --schema ${schema}`);
  run("node scripts/copy-trace-viewer.mjs");
  rmSync(".next", { recursive: true, force: true });
  run("npx next build");

  rmSync("dist", { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(".next/standalone", out, { recursive: true });
  cpSync(".next/static", `${out}/.next/static`, { recursive: true });
  cpSync("public", `${out}/public`, { recursive: true });
  cpSync("node_modules/.prisma/client", `${out}/node_modules/.prisma/client`, { recursive: true });
  cpSync("prisma/migrations", `${out}/prisma/migrations`, { recursive: true });
  cpSync("release/start.mjs", `${out}/start.mjs`);
  cpSync("release/README.txt", `${out}/README.txt`);
  // Image resizing (sharp) is never used and its binaries only suit this computer; TypeScript is only for building.
  for (const d of ["sharp", "@img", "typescript"]) rmSync(`${out}/node_modules/${d}`, { recursive: true, force: true });
  // Nothing private travels with it.
  for (const f of [".env", ".env.local"]) rmSync(`${out}/${f}`, { force: true });
  if (!existsSync(`${out}/server.js`)) throw new Error("The build has no server.js");
  console.log(`\nReady-to-run build is in ${out}`);
} finally {
  rmSync(schema, { force: true });
  // Back to this computer's engine only, for development.
  run("npx prisma generate");
}
