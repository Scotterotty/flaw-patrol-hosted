// Mini game XP check (ver_120): for every person in the database, works out their XP numbers
// the old way (scripts/xp-before-ver120.ts) and the ver_120 way (src/lib/xp.ts), and fails
// unless every number matches exactly. Prints how long each way took.
//
// Run: npm run check:xp (DATABASE_URL picks the database; e2e:all runs it on the test database).
import Module from "node:module";
import { isDeepStrictEqual } from "node:util";

// XP reads the glossary, which loads sign-in helpers that import next/navigation; outside Next,
// point that at its server build so the script can load (pages are unaffected).
const resolve = (Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: typeof resolve })._resolveFilename = (request, ...rest) =>
  resolve(request === "next/navigation" ? "next/dist/client/components/navigation.react-server.js" : request, ...rest);

async function main() {
  const { db } = await import("@/lib/db");
  const { gameStats } = await import("@/lib/xp");
  const { gameStatsBefore } = await import("./xp-before-ver120");
  const users = await db.user.findMany({ select: { id: true, email: true } });
  let bad = 0;
  let before = 0;
  let after = 0;
  for (const u of users) {
    let t = performance.now();
    const old = await gameStatsBefore(u.id);
    before += performance.now() - t;
    t = performance.now();
    const now = await gameStats(u.id);
    after += performance.now() - t;
    if (!isDeepStrictEqual(old, now)) {
      bad++;
      const keys = Object.keys({ ...old, ...now }) as (keyof typeof old)[];
      console.log(`✗ ${u.email}: ` + keys.filter((k) => !isDeepStrictEqual(old[k], now[k])).map((k) => `${k} ${JSON.stringify(old[k])} → ${JSON.stringify(now[k])}`).join(", "));
    }
  }
  console.log(`XP check: ${users.length} people, ${bad} different. Old way ${Math.round(before)} ms, new way ${Math.round(after)} ms in all.`);
  await db.$disconnect();
  if (bad) process.exit(1);
}
void main();
