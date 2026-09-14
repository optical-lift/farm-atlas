import { NextRequest, NextResponse } from "next/server";

import { verifyStripeOAuthState } from "@/lib/atlas/financial/stripe-security-core.js";
import {
  exchangeStripeOAuthCode,
  putStripeSourceSecret,
  stripeFinancialSourceConfig,
} from "@/lib/atlas/financial/stripe-server";
import { getAtlasSession, membershipForOrganization } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STRIPE_OAUTH_NONCE_COOKIE = "atlas_stripe_financial_oauth_nonce";

function ownerRedirect(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/owner", request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.set(STRIPE_OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 0,
    path: "/api/atlas/financial/stripe/callback",
  });
  return response;
}

export async function GET(request: NextRequest) {
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    return ownerRedirect(request, { financialSourceError: `stripe_${providerError}` });
  }

  const code = request.nextUrl.searchParams.get("code")?.trim();
  const state = request.nextUrl.searchParams.get("state")?.trim();
  if (!code || !state) return ownerRedirect(request, { financialSourceError: "stripe_callback_incomplete" });

  const session = await getAtlasSession();
  if (!session) return ownerRedirect(request, { financialSourceError: "sign_in_required" });

  let verified;
  try {
    verified = verifyStripeOAuthState(state, stripeFinancialSourceConfig().stateSigningSecret);
  } catch {
    return ownerRedirect(request, { financialSourceError: "stripe_connection_not_configured" });
  }
  if (!verified.ok) {
    return ownerRedirect(request, { financialSourceError: `stripe_${verified.error}` });
  }

  const nonce = request.cookies.get(STRIPE_OAUTH_NONCE_COOKIE)?.value;
  if (!nonce || nonce !== verified.payload.nonce || verified.payload.userId !== session.userId) {
    return ownerRedirect(request, { financialSourceError: "stripe_oauth_context_mismatch" });
  }

  const organizationId = verified.payload.organizationId;
  const membership = membershipForOrganization(session, organizationId);
  if (!membership || membership.role !== "owner") {
    return ownerRedirect(request, { financialSourceError: "organization_owner_required" });
  }

  const redirectUri = new URL("/api/atlas/financial/stripe/callback", request.url).toString();
  let sourceId: string | null = null;
  try {
    const token = await exchangeStripeOAuthCode(code, redirectUri);
    const supabase = await createAtlasServerClient();
    const { data: source, error: sourceError } = await supabase.rpc(
      "register_organization_connected_source_api_v1",
      {
        p_organization_id: organizationId,
        p_provider_key: "stripe",
        p_provider_account_key: token.stripe_user_id,
        p_display_label: "Stripe",
        p_account_hint: token.stripe_user_id,
        p_authorization_state: "connected",
        p_granted_scopes: [token.scope || "read_only"],
        p_capabilities: {
          financialObservation: true,
          financialReconciliationEvidence: true,
          moneyCollection: false,
        },
        p_metadata: {
          provider: "stripe",
          oauthMode: "extension_read_only",
          livemode: token.livemode ?? null,
          tokenType: token.token_type ?? null,
        },
      },
    );
    if (sourceError) throw new Error(sourceError.message);
    sourceId = typeof source?.sourceId === "string" ? source.sourceId : null;
    if (!sourceId) throw new Error("Atlas did not return a connected source id.");

    await putStripeSourceSecret(
      sourceId,
      "oauth_access_token",
      token.access_token,
      "Stripe read-only OAuth authorization completed.",
    );
    if (token.refresh_token) {
      await putStripeSourceSecret(
        sourceId,
        "oauth_refresh_token",
        token.refresh_token,
        "Stripe read-only OAuth authorization completed.",
      );
    }

    return ownerRedirect(request, {
      financialSource: "stripe",
      financialSourceState: "connected",
      sourceId,
    });
  } catch (error) {
    if (sourceId) {
      try {
        const supabase = await createAtlasServerClient();
        await supabase.rpc("transition_organization_connected_source_api_v1", {
          p_organization_id: organizationId,
          p_connected_source_id: sourceId,
          p_to_state: "error",
          p_granted_scopes: null,
          p_capabilities: null,
          p_reason: "Stripe OAuth callback could not complete credential custody.",
          p_metadata: { provider: "stripe", callbackFailed: true },
        });
      } catch {
        // The primary callback failure remains the useful result.
      }
    }
    return ownerRedirect(request, {
      financialSourceError: "stripe_oauth_completion_failed",
      detail: error instanceof Error ? error.message.slice(0, 160) : "unknown",
    });
  }
}
