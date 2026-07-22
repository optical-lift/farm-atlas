import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { atlasPostLoginPath } from "@/lib/atlas/auth-core.js";
import { legacyTaskRedirectCore } from "@/lib/atlas/task-routing-core.js";
import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

const LEGACY_MUTATION_REWRITES = new Map([
  ["POST /api/atlas/closeout", "/api/atlas/closeout-save"],
  ["POST /api/atlas/germination-check", "/api/atlas/germination-check-save"],
]);

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

function needsAtlasFarmMembership(pathname: string) {
  return pathname.startsWith("/api/atlas/") && !pathname.startsWith("/api/atlas/auth/");
}

function legacyMutationDestination(request: NextRequest) {
  return LEGACY_MUTATION_REWRITES.get(`${request.method.toUpperCase()} ${request.nextUrl.pathname}`) ?? null;
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
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  const authenticated = Boolean(userId);
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

  if (authenticated && pathname === "/login") {
    const atlasHomeUrl = request.nextUrl.clone();
    atlasHomeUrl.pathname = atlasPostLoginPath();
    atlasHomeUrl.search = "";
    return copySessionCookies(response, NextResponse.redirect(atlasHomeUrl));
  }

  if (authenticated && needsAtlasFarmMembership(pathname)) {
    const { data: membership, error: membershipError } = await supabase
      .from("farm_memberships")
      .select("id, farm:farms!inner(stable_key)")
      .eq("user_id", userId)
      .eq("active", true)
      .eq("farm.stable_key", "elm_farm")
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership) {
      return copySessionCookies(
        response,
        NextResponse.json(
          { ok: false, error: "Active Elm Farm membership required." },
          { status: 403, headers: { "Cache-Control": "private, no-store" } },
        ),
      );
    }

    const rewritePath = legacyMutationDestination(request);
    if (rewritePath) {
      const destination = request.nextUrl.clone();
      destination.pathname = rewritePath;
      return copySessionCookies(response, NextResponse.rewrite(destination));
    }
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
