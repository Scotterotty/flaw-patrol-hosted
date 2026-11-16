import "server-only";
import { db } from "./db";

// Attachment files live in Postgres (Attachment.data, up to 100 MB). Backend team review §3,
// option 1: never load a whole file just to send part of it. These read the size, or one
// slice, straight from the database, so playing or scrubbing a video holds only the slice
// being sent in memory.

/** Bytes per slice when a file is sent in pieces. */
export const SLICE = 1024 * 1024;

/** The attachment's details without its file, plus the file's real size in bytes. */
export async function attachmentInfo(id: string) {
  const rows = await db.$queryRaw<{ id: string; projectId: string; uploadedById: string | null; bashItemId: string | null; contentType: string; fileName: string; bytes: number }[]>`
    SELECT "id", "projectId", "uploadedById", "bashItemId", "contentType", "fileName", octet_length("data")::int AS "bytes"
    FROM "Attachment" WHERE "id" = ${id}`;
  return rows[0] ?? null;
}

/** `length` bytes of the file from `start` (0-based). */
export async function attachmentSlice(id: string, start: number, length: number): Promise<Uint8Array> {
  const rows = await db.$queryRaw<{ chunk: Buffer | null }[]>`
    SELECT substring("data" from ${start + 1}::int for ${length}::int) AS "chunk" FROM "Attachment" WHERE "id" = ${id}`;
  const chunk = rows[0]?.chunk;
  return chunk ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : new Uint8Array();
}

/** The whole file, for sending it on (to Jira). Read only when it's actually sent. */
export async function attachmentBytes(id: string): Promise<Uint8Array> {
  const row = await db.attachment.findUnique({ where: { id }, select: { data: true } });
  return row ? new Uint8Array(row.data) : new Uint8Array();
}

/**
 * Bytes start..end (inclusive) as a stream that reads one slice at a time. A viewer who
 * stops watching cancels the stream, and no more slices are read.
 */
export function attachmentStream(id: string, start: number, end: number): ReadableStream<Uint8Array> {
  let at = start;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (at > end) return controller.close();
      const length = Math.min(SLICE, end - at + 1);
      try {
        const chunk = await attachmentSlice(id, at, length);
        if (!chunk.length) return controller.close();
        at += chunk.length;
        controller.enqueue(chunk);
      } catch (e) {
        controller.error(e);
      }
    },
  });
}

/**
 * The byte range a Range header asks for, as [start, end] inclusive; null for the whole file;
 * "bad" when it can't be served (416). Only single ranges ("bytes=0-", "bytes=100-199", "bytes=-500").
 */
export function byteRange(header: string | null, size: number): [number, number] | null | "bad" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  // An empty file has no bytes to give, so it goes out whole (not as a 416 error).
  if (!m || (!m[1] && !m[2]) || !size) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) return "bad";
  return [start, end];
}
