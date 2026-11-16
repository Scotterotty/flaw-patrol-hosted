import "server-only";
import { NextResponse } from "next/server";
import { attachmentInfo, attachmentStream, byteRange } from "@/lib/attachment-bytes";

type Info = NonNullable<Awaited<ReturnType<typeof attachmentInfo>>>;

/** The file as a download or inline view, in byte ranges when asked (videos, the trace viewer). */
export function attachmentResponse(req: Request, a: Info, extraHeaders: Record<string, string> = {}) {
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|video\/(mp4|webm))$/.test(a.contentType);
  // Videos are fetched in byte ranges so they can be scrubbed (Safari won't play them otherwise).
  const range = byteRange(req.headers.get("range"), a.bytes);
  if (range === "bad") return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${a.bytes}` } });
  const [start, end] = range ?? [0, a.bytes - 1];
  const extra: Record<string, string> = { "Accept-Ranges": "bytes" };
  if (range) extra["Content-Range"] = `bytes ${start}-${end}/${a.bytes}`;
  return new NextResponse(a.bytes ? attachmentStream(a.id, start, end) : null, {
    status: range ? 206 : 200,
    headers: {
      ...extra,
      "Content-Type": a.contentType,
      "Content-Length": String(a.bytes ? end - start + 1 : 0),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=3600",
      ...extraHeaders,
    },
  });
}
