import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { buildStripeOAuthAuthorizeUrl, createStripeOAuthState } from "@/lib/atlas/financial/stripe-security-core.js";
import { stripeFinancialSourceConfig } from "@/lib/atlas/financial/stripe-server";
import { getAtlasSession, membershipForOrganization } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

const STRIPE_OAUTH_NONCE_COOKIE = "atlas_stripe_financial_oauth_nonce";

function errorRedirect(request: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(`/owner?financialSourceError=${encodeURIComponent(reason)}`, request.url));
}

export async function GET(request: NextRequest) {
  const session = await getAtlasSession();
  if (!session) return errorRedirect(request, "sign_in_required");

  const organizationId = request.nextUrl.searchParams.get("organizationId")?.trim() || session.activeOrganizationId;
  if (!organizationId) return errorRedirect(request, "organization_required");
  const membership = membershipForOrganization(session, organizationId);
  if (!membership || membership.role !== "owner") {
    // The database command membrane also supports governed setup actors. The
    // ordinary app connect surface stays owner-only until onboarding exposes an
    // explicit setup-actor connector UI.
    return errorRedirect(request, "organization_owner_required");
  }

  try {
    const { clientId, stateSigningSecret } = stripeFinancialSourceConfig();
    const nonce = randomUUID();
    const state = createStripeOAuthState({
      userId: session.userId,
      organizationId,
      nonce,
      expiresAt: Date.now() + 10 * 60 * 1000,
    }, stateSigningSecret);
    const redirectUri = new URL("/api/atlas/financial/stripe/callback", request.url).toString();
    const authorizeUrl = buildStripeOAuthAuthorizeUrl({ clientId, redirectUri, state });
    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(STRIPE_OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      maxAge: 10 * 60,
      path: "/api/atlas/financial/stripe/callback",
    });
    return response;
  } catch {
    return errorRedirect(request, "stripe_connection_not_configured");
  }
}
