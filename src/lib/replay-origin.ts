// Hosted build (backend review: "Same-origin trace viewer"). Playwright's trace viewer shows
// pages captured in uploaded replay files. Served from the app's own address, a crafted file
// could run script with the viewer's access to the app. With TRACE_VIEWER_ORIGIN set (a second
// address IT points at the same server, e.g. https://flawpatrol-replays.example.com), the
// viewer and the replay files are served only there, where nobody is signed in, and the app
// shows them in a frame. Without it (laptop copies), the viewer stays on the app's address.
//
// Edge-safe (used by src/middleware.ts): no Node modules here.

function origin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

/** The separate address for replays, or null to keep them on the app's own address. */
export const replayOrigin = (env: string | undefined = process.env.TRACE_VIEWER_ORIGIN) => origin(env);

/** The app's own address (AUTH_URL), which may frame the viewer. */
export const appOriginFromEnv = (env: string | undefined = process.env.AUTH_URL) => origin(env);

/** Paths served on the replay address; everything else there is Not found. */
export const isReplayPath = (path: string) => path.startsWith("/trace-viewer/") || path.startsWith("/api/replay/");

/** Frame rules for the viewer's own files. */
export function viewerFrameHeaders(app: string | null, onReplayOrigin: boolean): Record<string, string> {
  if (onReplayOrigin && app) return { "Content-Security-Policy": `frame-ancestors ${app}; base-uri 'self'; object-src 'none'` };
  return { "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" };
}
