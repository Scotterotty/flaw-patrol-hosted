// Test runs New/Updated check (ver_129): counts every run's New and Updated cases the old way
// (scripts/news-before-ver129.ts) and the ver_129 way (src/lib/case-news-data.ts), in the same
// groups of up to 30 runs the Test runs lists ask for, and fails unless every count matches.
//
// Run: npm run check:news (DATABASE_URL picks the database; e2e:all runs it on the test database).
import Module from "node:module";
import { isDeepStrictEqual } from "node:util";

// Same as check-xp.ts: point next/navigation at its server build so the script can load.
const resolve = (Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: typeof resolve })._resolveFilename = (request, ...rest) =>
  resolve(request === "next/navigation" ? "next/dist/client/components/navigation.react-server.js" : request, ...rest);

async function main() {
  const { db } = await import("@/lib/db");
  const { caseNewsCounts } = await import("@/lib/case-news-data");
  const { caseNewsCountsBefore } = await import("./news-before-ver129");
  const runs = await db.testRun.findMany({ select: { id: true, projectId: true }, orderBy: [{ projectId: "asc" }, { number: "desc" }] });
  const groups: string[][] = [];
  for (const r of runs) {
    const last = groups.at(-1);
    if (last && last.length < 30 && runs.find((x) => x.id === last[0])!.projectId === r.projectId) last.push(r.id);
    else groups.push([r.id]);
  }
  let bad = 0;
  let before = 0;
  let after = 0;
  let marked = 0;
  for (const ids of groups) {
    let t = performance.now();
    const old = await caseNewsCountsBefore(ids);
    before += performance.now() - t;
    t = performance.now();
    const now = await caseNewsCounts(ids);
    after += performance.now() - t;
    for (const id of ids) {
      if (old.get(id)) marked++;
      if (!isDeepStrictEqual(old.get(id), now.get(id))) {
        bad++;
        console.log(`✗ run ${id}: ${JSON.stringify(old.get(id))} → ${JSON.stringify(now.get(id))}`);
      }
    }
  }
  console.log(`New/Updated check: ${runs.length} runs (${marked} with New or Updated cases), ${bad} different. Old way ${Math.round(before)} ms, new way ${Math.round(after)} ms in all.`);
  await db.$disconnect();
  if (bad) process.exit(1);
}
void main();
