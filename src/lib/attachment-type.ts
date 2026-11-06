// Which files can be attached to a result or bug, and what type they are stored as.
// Browsers report a file's type from the computer's own settings, so a .log can arrive as
// "", "text/x-log", or "application/octet-stream" (common on Windows). Logs and crash files
// are judged by their name instead, and a log must really be text.

const MB = 1024 * 1024;
export const MAX_ATTACHMENT = 10 * MB;
// Screen recordings run up to 5 minutes, so videos get more room.
export const MAX_VIDEO = 75 * MB;
// Game logs and crash dumps get big; this matches Jira's usual attachment limit.
export const MAX_LOG = 24 * MB;

const ALLOWED = /^(image\/(png|jpeg|gif|webp)|text\/plain|application\/(pdf|json|zip|x-zip-compressed|octet-stream)|video\/(mp4|webm))$/;

/** Text logs: .log, .txt, rotated logs (output.log.1, Game.log.bak), Mac crash reports (.crash, .ips). */
export const isLogName = (name: string) => /\.(log|txt|crash|ips)$|\.log\.(\d+|bak|old)$/i.test(name);
/** Windows crash dumps. They download when opened; nothing shows them in a browser. */
export const isDumpName = (name: string) => /\.(dmp|mdmp)$/i.test(name);

/** True when the start of the file looks like text: no zero bytes, or a UTF-16 marker. */
export function looksLikeText(head: Uint8Array) {
  if (head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) return true;
  return !head.subarray(0, 8192).includes(0);
}

export const NOT_ALLOWED = "Attach images, PDFs, logs, crash dumps, JSON, zip or video files.";

/**
 * The type to store a file as, or an error to show. `head` is the first bytes of the file.
 * Only logs and crash dumps may be stored as application/octet-stream.
 */
export function attachmentType(name: string, browserType: string, size: number, head: Uint8Array): { type: string; error?: undefined } | { error: string; type?: undefined } {
  const label = name || "That file";
  const video = /^video\/(mp4|webm)$/.test(browserType);
  const log = isLogName(name);
  const dump = isDumpName(name);
  const max = video ? MAX_VIDEO : log || dump ? MAX_LOG : MAX_ATTACHMENT;
  if (size > max) {
    if (video) return { error: "Videos can be up to 75 MB." };
    if (log || dump) return { error: `${label} is over 24 MB. Zip it and attach the zip, or attach the end of the log.` };
    return { error: "Files can be up to 10 MB." };
  }
  if (log) {
    if (!looksLikeText(head)) return { error: `${label} isn't a text log. ${NOT_ALLOWED}` };
    return { type: "text/plain" };
  }
  if (dump) return { type: "application/octet-stream" };
  const type = browserType || "application/octet-stream";
  if (type === "application/octet-stream" || !ALLOWED.test(type)) return { error: name ? `${name} can't be attached. ${NOT_ALLOWED}` : NOT_ALLOWED };
  return { type };
}
