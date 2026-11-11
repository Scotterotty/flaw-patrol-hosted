import "server-only";
import { db } from "./db";
import { PRACTICE_DAYS } from "./practice";

/** Remove practice spaces older than PRACTICE_DAYS. Cheap, so it runs whenever Start here looks for yours. */
export async function sweepPractice(now = Date.now()) {
  await db.project.deleteMany({ where: { practiceFor: { not: null }, createdAt: { lt: new Date(now - PRACTICE_DAYS * 24 * 3600 * 1000) } } });
}

/** Your practice run, if you have one: where it is and how far you got. */
export async function myPractice(userId: string) {
  await sweepPractice();
  const p = await db.project.findUnique({
    where: { practiceFor: userId },
    select: { key: true, createdAt: true, runs: { orderBy: { number: "asc" }, take: 1, select: { number: true, entries: { select: { status: true } } } } },
  });
  const run = p?.runs[0];
  if (!p || !run) return null;
  const tested = run.entries.filter((e) => e.status !== "UNTESTED" && e.status !== "IN_PROGRESS").length;
  return { key: p.key, number: run.number, tested, total: run.entries.length, href: `/p/${p.key}/runs/${run.number}/execute` };
}
