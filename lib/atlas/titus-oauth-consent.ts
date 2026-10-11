import "server-only";

/** One configured Atlas-issued client; this route never grants research permission. */
export function titusOAuthConsentConfig() {
  const clientId = process.env.ATLAS_TITUS_OAUTH_CLIENT_ID ?? "";
  const callback = process.env.ATLAS_TITUS_OAUTH_REDIRECT_URI ?? "";
  const origin = process.env.ATLAS_OAUTH_CONSENT_ORIGIN ?? "";
  try {
    const target = new URL(callback);
    const issuer = new URL(origin);
    if (!/^[0-9a-fA-F-]{36}$/.test(clientId) ||
      target.protocol !== "https:" || target.pathname !== "/constellation/auth/callback" ||
      target.search || target.hash || target.username || target.password || target.port ||
      issuer.protocol !== "https:" || issuer.pathname !== "/" || issuer.search || issuer.hash ||
      issuer.username || issuer.password || issuer.port) return null;
    return { clientId, callback, origin: issuer.origin };
  } catch { return null; }
}

export function approvedOAuthDetails(data: unknown, config: NonNullable<ReturnType<typeof titusOAuthConsentConfig>>) {
  if (!data || typeof data !== "object") return false;
  const details = data as { redirect_uri?: string; client?: { id?: string; client_id?: string } };
  return details.redirect_uri === config.callback &&
    (details.client?.id ?? details.client?.client_id) === config.clientId;
}

export function approvedOAuthReturn(value: string, config: NonNullable<ReturnType<typeof titusOAuthConsentConfig>>) {
  try {
    const actual = new URL(value);
    const target = new URL(config.callback);
    return actual.protocol === "https:" && actual.origin === target.origin &&
      actual.pathname === target.pathname && !actual.username && !actual.password;
  } catch { return false; }
}
