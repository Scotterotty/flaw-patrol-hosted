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
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api/auth|api/ci/|signin|_next|favicon.ico|icon|apple-icon|brand/|reset/|invite/).*)"] };
