// Mini game crowns check (ver_129): opens every person's crowns (the Account page's list) the
// old way (scripts/crowns-before-ver129.ts) and the ver_129 way (src/lib/crowns.ts), each from
// the same starting crowns, and fails unless the lists, the saved crowns and everyone's worn
// titles all match. Then opens them again the new way and checks nothing was saved twice.
//
// It puts the starting crowns back between the two ways, so it only runs on a local database.
// Run: npm run check:crowns (DATABASE_URL picks the database; e2e:all runs it on the test database).
import Module from "node:module";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";

// Same as check-xp.ts: point next/navigation at its server build so the script can load.
const resolve = (Module as unknown as { _resolveFilename: (r: string, ...a: unknown[]) => string })._resolveFilename;
(Module as unknown as { _resolveFilename: typeof resolve })._resolveFilename = (request, ...rest) =>
  resolve(request === "next/navigation" ? "next/dist/client/components/navigation.react-server.js" : request, ...rest);

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.log("Crowns check: skipped, it only runs on a local database (it puts crowns back as they were).");
    return;
  }
  const { db } = await import("@/lib/db");
  const { crownsFor } = await import("@/lib/crowns");
  const { crownsForBefore } = await import("./crowns-before-ver129");
  const users = await db.user.findMany({ select: { id: true, email: true }, orderBy: { email: "asc" } });
  const start = await db.crown.findMany();
  const titles = await db.user.findMany({ select: { id: true, gameTitle: true, gameTitleBefore: true } });
  const startSince = new Map(start.map((c) => [`${c.groupId}|${c.key}`, c.since.getTime()]));

  const putBack = async () => {
    await db.crown.deleteMany({});
    if (start.length) await db.crown.createMany({ data: start.map((c) => ({ ...c, counts: (c.counts ?? {}) as Prisma.InputJsonValue })) });
    for (const t of titles) await db.user.update({ where: { id: t.id }, data: { gameTitle: t.gameTitle, gameTitleBefore: t.gameTitleBefore } });
  };
  // A crown that changed hands gets a new "since"; only whether it kept the starting one can match.
  const view = (list: Awaited<ReturnType<typeof crownsFor>>) => list.map((c) => ({ ...c, since: startSince.get(`${c.groupId}|${c.key}`) === c.since.getTime() ? "kept" : "new" }));
  const saved = async () =>
    (await db.crown.findMany({ orderBy: [{ groupId: "asc" }, { key: "asc" }] })).map((c) => ({ groupId: c.groupId, key: c.key, label: c.label, userId: c.userId, counts: c.counts, since: startSince.get(`${c.groupId}|${c.key}`) === c.since.getTime() ? "kept" : "new" }));
  const worn = async () => db.user.findMany({ select: { id: true, gameTitle: true, gameTitleBefore: true }, orderBy: { id: "asc" } });

  const run = async (fn: typeof crownsFor) => {
    const out = new Map<string, unknown>();
    const t = performance.now();
    for (const u of users) out.set(u.id, view(await fn(u.id)));
    return { out, ms: performance.now() - t, rows: await saved(), titles: await worn() };
  };

  let bad = 0;
  try {
    const old = await run(crownsForBefore);
    await putBack();
    const now = await run(crownsFor);
    for (const u of users)
      if (!isDeepStrictEqual(old.out.get(u.id), now.out.get(u.id))) {
        bad++;
        console.log(`✗ ${u.email}: crowns list differs\n  old ${JSON.stringify(old.out.get(u.id))}\n  new ${JSON.stringify(now.out.get(u.id))}`);
      }
    if (!isDeepStrictEqual(old.rows, now.rows)) {
      bad++;
      console.log(`✗ saved crowns differ\n  old ${JSON.stringify(old.rows)}\n  new ${JSON.stringify(now.rows)}`);
    }
    if (!isDeepStrictEqual(old.titles, now.titles)) {
      bad++;
      console.log("✗ worn titles differ");
    }
    // Opening again with nothing new to count saves nothing (ver_129 saves only what changed).
    const before = await db.crown.findMany({ select: { id: true, updatedAt: true } });
    const again = await run(crownsFor);
    const after = new Map((await db.crown.findMany({ select: { id: true, updatedAt: true } })).map((c) => [c.id, c.updatedAt.getTime()]));
    const resaved = before.filter((c) => after.get(c.id) !== c.updatedAt.getTime()).length;
    if (resaved) {
      bad++;
      console.log(`✗ ${resaved} crowns saved again with nothing new to count`);
    }
    if (!isDeepStrictEqual(now.out, again.out)) {
      bad++;
      console.log("✗ second opening gave different crowns");
    }
    const crowns = now.rows.length;
    const held = now.rows.filter((r) => r.userId).length;
    console.log(
      `Crowns check: ${users.length} people, ${crowns} crowns (${held} held), ${bad} different. Old way ${Math.round(old.ms)} ms, new way ${Math.round(now.ms)} ms, new way again ${Math.round(again.ms)} ms in all.`,
    );
  } finally {
    await db.$disconnect();
  }
  if (bad) process.exit(1);
}
void main();
