import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { atlasPostLoginPath } from "@/lib/atlas/auth-core.js";
import { legacyTaskRedirectCore } from "@/lib/atlas/task-routing-core.js";
import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

const ATLAS_PRODUCT_RESET = true;

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

function isSafeInternalPath(value: string | null) {
  return Boolean(value && value.startsWith("/") && !value.startsWith("//"));
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/welcome" ||
    pathname === "/start" ||
    pathname.startsWith("/start/") ||
    pathname === "/login" ||
    pathname === "/join" ||
    pathname === "/auth/confirm" ||
    pathname === "/auth/error" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/offline" ||
    pathname === "/local" ||
    pathname.startsWith("/local/") ||
    pathname.startsWith("/api/local/") ||
    pathname.startsWith("/api/pwa/icon") ||
    pathname.startsWith("/api/atlas/auth/")
  );
}

function isResetPublicPage(pathname: string) {
  return (
    pathname === "/welcome" ||
    pathname === "/start" ||
    pathname.startsWith("/start/") ||
    pathname === "/login" ||
    pathname === "/join" ||
    pathname === "/auth/confirm" ||
    pathname === "/auth/error"
  );
}

function isResetOnboardingPath(pathname: string) {
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}

function isExternallyAuthenticatedPath(pathname: string) {
  return pathname === "/api/continuity/messages/ingest";
}

function needsAtlasPortfolioMembership(pathname: string) {
  return (
    pathname.startsWith("/api/atlas/projects/") ||
    pathname.startsWith("/api/atlas/project-tasks/") ||
    pathname.startsWith("/api/atlas/portfolio/")
  );
}

function needsAtlasFarmMembership(pathname: string) {
  return (
    pathname.startsWith("/api/atlas/") &&
    !pathname.startsWith("/api/atlas/auth/") &&
    !pathname.startsWith("/api/atlas/organizations/") &&
    !needsAtlasPortfolioMembership(pathname)
  );
}

function legacyMutationDestination(request: NextRequest) {
  return LEGACY_MUTATION_REWRITES.get(`${request.method.toUpperCase()} ${request.nextUrl.pathname}`) ?? null;
}

function resetLoginUrl(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return loginUrl;
}

function resetRootUrl(request: NextRequest) {
  const rootUrl = request.nextUrl.clone();
  rootUrl.pathname = "/";
  rootUrl.search = "";
  return rootUrl;
}

function resetWelcomeUrl(request: NextRequest) {
  const welcomeUrl = request.nextUrl.clone();
  welcomeUrl.pathname = "/welcome";
  welcomeUrl.search = "";
  return welcomeUrl;
}

function resetErrorUrl(request: NextRequest) {
  const errorUrl = request.nextUrl.clone();
  errorUrl.pathname = "/auth/error";
  errorUrl.search = "";
  errorUrl.searchParams.set("reason", "access_decommissioned");
  return errorUrl;
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

  if (authenticated && userId) {
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("active")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError || profile?.active !== true) {
      // Decommissioning removes Atlas product access, not the public front door.
      // A stale signed-in session must still be able to read the sales/start/login
      // surfaces and replace its credentials with a different Atlas account.
      if (pathname === "/") {
        return copySessionCookies(response, NextResponse.rewrite(resetWelcomeUrl(request)));
      }
      if (isPublicPath(pathname)) return response;

      if (pathname.startsWith("/api/")) {
        return copySessionCookies(
          response,
          NextResponse.json(
            { ok: false, error: "Atlas access is decommissioned for this account." },
            { status: 403, headers: { "Cache-Control": "private, no-store" } },
          ),
        );
      }
      return copySessionCookies(response, NextResponse.redirect(resetErrorUrl(request)));
    }
  }

  if (ATLAS_PRODUCT_RESET && !pathname.startsWith("/api/")) {
    if (pathname === "/") {
      if (!authenticated) {
        return copySessionCookies(response, NextResponse.rewrite(resetWelcomeUrl(request)));
      }

      const destination = request.nextUrl.clone();
      destination.pathname = "/reset";
      destination.search = "";
      return copySessionCookies(response, NextResponse.rewrite(destination));
    }

    // Public presentation stays public during the reset, even when the browser
    // already holds an authenticated session. This lets people see the sales
    // funnel and lets a decommissioned session switch accounts at /login.
    if (isResetPublicPage(pathname)) return response;

    // The retained active account still needs to exercise the new onboarding
    // path while the legacy Atlas product tree remains decommissioned.
    if (authenticated && isResetOnboardingPath(pathname)) return response;

    if (!authenticated) {
      return copySessionCookies(response, NextResponse.redirect(resetLoginUrl(request)));
    }

    if (pathname !== "/reset") {
      return copySessionCookies(response, NextResponse.redirect(resetRootUrl(request)));
    }
  }

  // The root URL is the Atlas product front door for visitors. Existing authenticated
  // users keep the current application Home at `/`, so no Elm/Feast Guild behavior is moved.
  if (!authenticated && pathname === "/") {
    const destination = request.nextUrl.clone();
    destination.pathname = "/welcome";
    destination.search = "";
    return copySessionCookies(response, NextResponse.rewrite(destination));
  }

  if (!authenticated && !isPublicPath(pathname) && !isExternallyAuthenticatedPath(pathname)) {
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
    const requestedNext = request.nextUrl.searchParams.get("next");
    const atlasHomeUrl = request.nextUrl.clone();
    atlasHomeUrl.pathname = isSafeInternalPath(requestedNext) ? requestedNext! : atlasPostLoginPath();
    atlasHomeUrl.search = "";
    return copySessionCookies(response, NextResponse.redirect(atlasHomeUrl));
  }

  if (authenticated && needsAtlasPortfolioMembership(pathname)) {
    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("id, organization:organizations!inner(stable_key)")
      .eq("user_id", userId)
      .eq("active", true)
      .eq("organization.stable_key", "feast_guild")
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership) {
      return copySessionCookies(
        response,
        NextResponse.json(
          { ok: false, error: "Active Feast Guild membership required." },
          { status: 403, headers: { "Cache-Control": "private, no-store" } },
        ),
      );
    }
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
