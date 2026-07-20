import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { legacyTaskRedirectCore } from "@/lib/atlas/task-routing-core.js";
import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

function copySessionCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  for (const headerName of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(headerName);
    if (value) target.headers.set(headerName, value);
  }
  return target;
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/auth/confirm" ||
    pathname === "/auth/error" ||
    pathname.startsWith("/api/atlas/auth/")
  );
}

export async function updateAtlasSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = getAtlasSupabaseConfig();

  const supabase = createServerClient(url, publishableKey, {
    db: { schema: "atlas" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headersToSet).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const authenticated = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  if (!authenticated && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return copySessionCookies(
        response,
        NextResponse.json(
          { ok: false, error: "Authentication required." },
          { status: 401, headers: { "Cache-Control": "private, no-store" } },
        ),
      );
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    }
    return copySessionCookies(response, NextResponse.redirect(loginUrl));
  }

  if (authenticated && pathname === "/task") {
    const destination = legacyTaskRedirectCore(
      request.url,
      request.headers.get("referer") ?? undefined,
    );
    if (destination) {
      return copySessionCookies(response, NextResponse.redirect(destination));
    }
  }

  return response;
}
