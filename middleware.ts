import { NextRequest, NextResponse } from "next/server";
import { legacyTaskRedirectCore } from "@/lib/atlas/task-routing-core.js";

const ACCESS_COOKIE = "atlas_access_token";
const REFRESH_COOKIE = "atlas_refresh_token";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/task") {
    const destination = legacyTaskRedirectCore(request.url, request.headers.get("referer") ?? undefined);
    if (destination) return NextResponse.redirect(destination);
  }

  const hasSession =
    Boolean(request.cookies.get(ACCESS_COOKIE)?.value) ||
    Boolean(request.cookies.get(REFRESH_COOKIE)?.value);

  if (!hasSession) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|api/atlas/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
