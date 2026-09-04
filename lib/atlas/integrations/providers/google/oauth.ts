import type { IntegrationSecretHandle } from "../../contract";

export const GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthAuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: readonly string[];
  loginHint?: string | null;
  prompt?: "consent" | "select_account" | null;
}

export interface GoogleOAuthAuthorizationPlan {
  authorizationUrl: string;
  requestedScopes: readonly string[];
  state: string;
  accessType: "offline";
  incrementalAuthorization: true;
}

export interface GoogleOAuthCredentialCustody {
  oauthClient: IntegrationSecretHandle & { purpose: "oauth_client" };
  oauthConnection: IntegrationSecretHandle & { purpose: "oauth_connection" };
}

function assertHttpsOrLocalhost(uri: string): void {
  const parsed = new URL(uri);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("Google OAuth redirectUri must use HTTPS except for localhost development.");
  }
}

function normalizedScopes(scopes: readonly string[]): string[] {
  const values = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
  if (!values.length) throw new Error("Google OAuth requires at least one requested scope.");
  return values;
}

/**
 * Builds the authorization redirect only. Secret material and token exchange are
 * runtime responsibilities referenced through opaque secret handles.
 */
export function buildGoogleOAuthAuthorizationPlan(
  request: GoogleOAuthAuthorizationRequest,
): GoogleOAuthAuthorizationPlan {
  if (!request.clientId.trim()) throw new Error("Google OAuth clientId is required.");
  assertHttpsOrLocalhost(request.redirectUri);
  if (request.state.trim().length < 32) {
    throw new Error("Google OAuth state must be a high-entropy runtime-generated value.");
  }

  const scopes = normalizedScopes(request.scopes);
  const url = new URL(GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", request.clientId);
  url.searchParams.set("redirect_uri", request.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", request.state);
  url.searchParams.set("scope", scopes.join(" "));
  if (request.loginHint?.trim()) url.searchParams.set("login_hint", request.loginHint.trim());
  if (request.prompt) url.searchParams.set("prompt", request.prompt);

  return {
    authorizationUrl: url.toString(),
    requestedScopes: scopes,
    state: request.state,
    accessType: "offline",
    incrementalAuthorization: true,
  };
}

export function assertGoogleOAuthCallbackState(receivedState: string, expectedState: string): void {
  if (!receivedState || !expectedState || receivedState !== expectedState) {
    throw new Error("Google OAuth callback state mismatch.");
  }
}

export function assertGoogleOAuthCredentialCustody(custody: GoogleOAuthCredentialCustody): void {
  if (!custody.oauthClient.secretRef.trim() || custody.oauthClient.purpose !== "oauth_client") {
    throw new Error("Google OAuth client credential must be an oauth_client secret handle.");
  }
  if (!custody.oauthConnection.secretRef.trim() || custody.oauthConnection.purpose !== "oauth_connection") {
    throw new Error("Google OAuth connection credential must be an oauth_connection secret handle.");
  }
}
