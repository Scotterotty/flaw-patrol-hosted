import { NextResponse, type NextRequest } from "next/server";

// Cheap cookie check so signed-out visitors land on /signin. Real authorization
// happens on the server for every page and action (see src/lib/session.ts).
export function middleware(req: NextRequest) {
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
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!api/healthz|api/readyz|api/auth|api/ci/|api/qase/hook/|signin|_next|favicon.ico|icon|apple-icon|brand/|reset/|invite/|stop-emails).*)"] };
