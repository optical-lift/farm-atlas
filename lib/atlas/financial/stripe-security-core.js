import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_OAUTH_AUTHORIZE_URL = "https://connect.stripe.com/oauth/authorize";
const SHA256_HEX = /^[0-9a-f]{64}$/i;

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function equalSha256Hex(expectedHex, actualHex) {
  if (!SHA256_HEX.test(expectedHex) || !SHA256_HEX.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return timingSafeEqual(expected, actual);
}

export function createStripeOAuthState(payload, signingSecret) {
  const secret = requireString(signingSecret, "Stripe OAuth state signing secret");
  const value = requireObject(payload, "Stripe OAuth state payload");
  requireString(value.userId, "Stripe OAuth state userId");
  requireString(value.organizationId, "Stripe OAuth state organizationId");
  requireString(value.nonce, "Stripe OAuth state nonce");
  if (!Number.isFinite(value.expiresAt)) throw new Error("Stripe OAuth state expiresAt is required.");
  const encoded = base64UrlEncode(JSON.stringify(value));
  const signature = createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function verifyStripeOAuthState(state, signingSecret, nowMs = Date.now()) {
  const secret = requireString(signingSecret, "Stripe OAuth state signing secret");
  const parts = String(state ?? "").split(".");
  if (parts.length !== 2) return { ok: false, error: "invalid_state" };
  const [encoded, signature] = parts;
  if (!encoded || !SHA256_HEX.test(signature)) return { ok: false, error: "invalid_signature" };
  const expected = createHmac("sha256", secret).update(encoded).digest("hex");
  if (!equalSha256Hex(expected, signature)) return { ok: false, error: "invalid_signature" };
  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    requireString(payload.userId, "Stripe OAuth state userId");
    requireString(payload.organizationId, "Stripe OAuth state organizationId");
    requireString(payload.nonce, "Stripe OAuth state nonce");
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt < nowMs) {
      return { ok: false, error: "expired_state" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, error: "invalid_payload" };
  }
}

export function buildStripeOAuthAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(STRIPE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requireString(clientId, "Stripe Connect client id"));
  url.searchParams.set("scope", "read_only");
  url.searchParams.set("redirect_uri", requireString(redirectUri, "Stripe OAuth redirect URI"));
  url.searchParams.set("state", requireString(state, "Stripe OAuth state"));
  return url.toString();
}

export function verifyStripeWebhookSignature({
  rawBody,
  signatureHeader,
  webhookSecret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
}) {
  const secret = requireString(webhookSecret, "Stripe webhook signing secret");
  const entries = String(signatureHeader ?? "")
    .split(",")
    .map((part) => part.trim().split("="))
    .filter(([key, value]) => key && value);
  const timestampText = entries.find(([key]) => key === "t")?.[1];
  if (!timestampText || !/^\d+$/.test(timestampText)) return { ok: false, error: "malformed_signature" };
  const timestamp = Number(timestampText);
  const signatures = entries
    .filter(([key, value]) => key === "v1" && SHA256_HEX.test(value))
    .map(([, value]) => value);
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) {
    return { ok: false, error: "malformed_signature" };
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, error: "timestamp_outside_tolerance" };
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody ?? "");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  if (!signatures.some((signature) => equalSha256Hex(expected, signature))) {
    return { ok: false, error: "invalid_signature" };
  }
  return { ok: true, timestamp };
}
