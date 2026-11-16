import { NextResponse, type NextRequest } from "next/server";
import { appOriginFromEnv, isReplayPath, replayOrigin, viewerFrameHeaders } from "@/lib/replay-origin";

const notFound = () => new NextResponse("Not found", { status: 404 });

// Cheap cookie check so signed-out visitors land on /signin. Real authorization
// happens on the server for every page and action (see src/lib/session.ts).
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Replays on their own address (TRACE_VIEWER_ORIGIN, see src/lib/replay-origin.ts): that
  // address serves only the viewer and replay files, and the app's address doesn't serve them.
  const replays = replayOrigin();
  if (replays) {
    const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
    const onReplayAddress = host === new URL(replays).host.toLowerCase();
    if (onReplayAddress) return isReplayPath(path) ? NextResponse.next({ headers: viewerFrameHeaders(appOriginFromEnv(), true) }) : notFound();
    if (isReplayPath(path)) return notFound();
  }
  const hasSession =
    req.cookies.has("authjs.session-token") || req.cookies.has("__Secure-authjs.session-token");
  if (!hasSession) {
    const url = new URL("/signin", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // Pages read the path they were opened at, so a shared link someone can't open
  // yet can say what it is and offer Ask to join instead of Not found.
  const headers = new Headers(req.headers);
  headers.set("x-fp-path", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers }, ...(path.startsWith("/trace-viewer/") && { headers: viewerFrameHeaders(null, false) }) });
}

export const config = { matcher: ["/((?!api/healthz|api/readyz|api/auth|api/ci/|api/qase/hook/|signin|_next|favicon.ico|icon|apple-icon|brand/|reset/|invite/|stop-emails).*)"] };
