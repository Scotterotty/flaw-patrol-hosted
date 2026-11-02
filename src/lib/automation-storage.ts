import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

// How much room automation's screenshots, videos and replays take, and which
// can go. Files on a result that has a bug are never deleted, so a bug keeps its proof.

export const MEDIA_KINDS = ["screenshot", "video", "trace"];

/** Deletable media: automation files on results with no bug linked. */
export function deletable(runs: Prisma.TestRunWhereInput): Prisma.AttachmentWhereInput {
  return { kind: { in: MEDIA_KINDS }, result: { run: runs, defects: { none: {} } } };
}

export async function groupProjectIds(groupId: string) {
  const rows = await db.project.findMany({ where: { groupId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** "Using 1.1 GB for 214 runs. About 40 MB a day at the current pace." */
export async function storageUsage(groupId: string) {
  const ids = await groupProjectIds(groupId);
  const where = { kind: { in: MEDIA_KINDS }, projectId: { in: ids } };
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [all, recent, runs] = await Promise.all([
    db.attachment.aggregate({ where, _sum: { size: true }, _count: true }),
    db.attachment.aggregate({ where: { ...where, createdAt: { gte: since } }, _sum: { size: true } }),
    db.testRun.count({ where: { projectId: { in: ids }, entries: { some: { results: { some: { attachments: { some: { kind: { in: MEDIA_KINDS } } } } } } } } }),
  ]);
  return { bytes: all._sum.size ?? 0, files: all._count, runs, perDay: Math.round((recent._sum.size ?? 0) / 14) };
}

/** What deleting would free: files, bytes and runs, and how many stay because they're on a bug. */
export async function deletePreview(runs: Prisma.TestRunWhereInput) {
  const [gone, kept, runCount] = await Promise.all([
    db.attachment.aggregate({ where: deletable(runs), _sum: { size: true }, _count: true }),
    db.attachment.count({ where: { kind: { in: MEDIA_KINDS }, result: { run: runs, defects: { some: {} } } } }),
    db.testRun.count({ where: { ...runs, entries: { some: { results: { some: { attachments: { some: { kind: { in: MEDIA_KINDS } }, }, defects: { none: {} } } } } } } }),
  ]);
  return { files: gone._count, bytes: gone._sum.size ?? 0, runs: runCount, onBugs: kept };
}

/** Delete them, and mark each run "Files deleted by …". */
export async function deleteMedia(runs: Prisma.TestRunWhereInput, by: string) {
  const touched = await db.testRun.findMany({ where: { ...runs, entries: { some: { results: { some: { attachments: { some: { kind: { in: MEDIA_KINDS } } }, defects: { none: {} } } } } } }, select: { id: true } });
  const { count } = await db.attachment.deleteMany({ where: deletable(runs) });
  if (touched.length) await db.testRun.updateMany({ where: { id: { in: touched.map((r) => r.id) } }, data: { filesDeletedBy: by, filesDeletedAt: new Date() } });
  return { files: count, runs: touched.length };
}
