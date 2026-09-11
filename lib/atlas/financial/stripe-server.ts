import { createHash } from "node:crypto";

import { createAtlasAdminClient } from "@/lib/supabase/admin";
import {
  normalizeStripeFinancialObject,
  stripeBalanceEventCandidates,
  stripeObservationFingerprint,
} from "@/lib/atlas/financial/stripe-core.js";

const STRIPE_API_ROOT = "https://api.stripe.com/v1";
const STRIPE_OAUTH_TOKEN_URL = "https://connect.stripe.com/oauth/token";

export type StripeOAuthTokenResponse = {
  access_token: string;
  refresh_token?: string | null;
  stripe_user_id: string;
  scope?: string | null;
  livemode?: boolean;
  token_type?: string | null;
};

type FinancialObservation = ReturnType<typeof normalizeStripeFinancialObject>;

type SyncRecordResult = {
  observationId: string;
  normalized: FinancialObservation;
  economicEventIds: string[];
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function jsonSha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function stripeFinancialSourceConfig() {
  return {
    clientId: requiredEnv("STRIPE_CONNECT_CLIENT_ID"),
    clientSecret: requiredEnv("STRIPE_CONNECT_CLIENT_SECRET"),
    stateSigningSecret: requiredEnv("STRIPE_OAUTH_STATE_SECRET"),
  };
}

export async function exchangeStripeOAuthCode(code: string, redirectUri: string) {
  const { clientSecret } = stripeFinancialSourceConfig();
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const response = await fetch(STRIPE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error_description === "string"
      ? payload.error_description
      : typeof payload?.error === "string"
        ? payload.error
        : "Stripe OAuth token exchange failed.";
    throw new Error(message);
  }
  if (!payload?.access_token || !payload?.stripe_user_id) {
    throw new Error("Stripe OAuth response did not include account identity and access token.");
  }
  return payload as StripeOAuthTokenResponse;
}

export async function stripeApiGet<T = Record<string, unknown>>(
  accessToken: string,
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<T> {
  const token = accessToken.trim();
  if (!token) throw new Error("Stripe source access token is required.");
  const url = new URL(`${STRIPE_API_ROOT}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error?.message === "string"
      ? payload.error.message
      : `Stripe API request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export async function putStripeSourceSecret(
  sourceId: string,
  secretKind: "oauth_access_token" | "oauth_refresh_token",
  value: string,
  reason: string,
) {
  const admin = createAtlasAdminClient();
  const { data, error } = await admin.rpc("put_connected_source_secret_core_v1", {
    p_connected_source_id: sourceId,
    p_secret_kind: secretKind,
    p_secret_value: value,
    p_reason: reason,
    p_metadata: { provider: "stripe", secretPurpose: "financial_source_sync" },
  });
  if (error) throw new Error(`Atlas Stripe credential custody failed: ${error.message}`);
  return data;
}

export async function readStripeSourceAccessToken(sourceId: string) {
  const admin = createAtlasAdminClient();
  const { data, error } = await admin.rpc("read_connected_source_secret_core_v1", {
    p_connected_source_id: sourceId,
    p_secret_kind: "oauth_access_token",
  });
  if (error) throw new Error(`Atlas Stripe credential read failed: ${error.message}`);
  if (typeof data !== "string" || !data) throw new Error("Stripe source has no active OAuth access token.");
  return data;
}

async function recordObservation(
  organizationId: string,
  sourceId: string,
  raw: Record<string, unknown>,
  providerEventId: string | null,
) {
  const admin = createAtlasAdminClient();
  const normalized = normalizeStripeFinancialObject(raw);
  const observedAt = new Date().toISOString();
  const { data, error } = await admin.rpc("record_financial_source_observation_core_v1", {
    p_organization_id: organizationId,
    p_connected_source_id: sourceId,
    p_provider_record_kind: normalized.providerRecordKind,
    p_provider_record_id: normalized.providerRecordId,
    p_observation_fingerprint: normalized.observationFingerprint,
    p_provider_event_id: providerEventId,
    p_observed_at: observedAt,
    p_effective_at: normalized.effectiveAt,
    p_direction: normalized.direction,
    p_gross_amount: normalized.grossAmount,
    p_fee_amount: normalized.feeAmount,
    p_net_amount: normalized.netAmount,
    p_currency: normalized.currency,
    p_counterparty_label: normalized.counterpartyLabel,
    p_document_number: normalized.documentNumber,
    p_description: normalized.description,
    p_provider_state: normalized.providerState,
    p_normalized_data: normalized.normalizedData,
    p_payload_sha256: jsonSha256(raw),
    p_metadata: {
      provider: "stripe",
      normalizedBy: "stripe_financial_source_adapter_v1",
    },
  });
  if (error) throw new Error(`Atlas financial observation write failed: ${error.message}`);
  const observationId = String(data?.observationId ?? "");
  if (!observationId) throw new Error("Atlas did not return a financial observation id.");
  return { normalized, observationId };
}

function balanceEventKey(sourceId: string, balanceTransactionId: string, eventKind: string) {
  return `financial:stripe:${sourceId}:balance:${balanceTransactionId}:${eventKind}`;
}

async function ensureBalanceEconomicEvents(
  organizationId: string,
  sourceId: string,
  observationId: string,
  normalized: FinancialObservation,
) {
  if (normalized.providerRecordKind !== "balance_transaction") return [];
  const admin = createAtlasAdminClient();
  const candidates = stripeBalanceEventCandidates(normalized);
  const eventIds: string[] = [];
  const eventByKind = new Map<string, string>();

  for (const candidate of candidates) {
    const eventKey = balanceEventKey(sourceId, normalized.providerRecordId, candidate.eventKind);
    const { data, error } = await admin.rpc("ensure_financial_economic_event_core_v1", {
      p_organization_id: organizationId,
      p_event_key: eventKey,
      p_event_kind: candidate.eventKind,
      p_direction: candidate.direction,
      p_amount: candidate.amount,
      p_currency: candidate.currency,
      p_occurred_at: normalized.effectiveAt ?? new Date().toISOString(),
      p_counterparty_kind: null,
      p_counterparty_id: null,
      p_counterparty_label: normalized.counterpartyLabel,
      p_source_domain: "external_financial_source",
      p_source_kind: "stripe_balance_transaction",
      p_source_id: normalized.providerRecordId,
      p_authority_kind: candidate.authorityKind,
      p_authority_ref: `connected_source:${sourceId}:balance_transaction:${normalized.providerRecordId}`,
      p_metadata: {
        provider: "stripe",
        sourceId,
        note: candidate.note ?? null,
        reportingCategory: normalized.normalizedData?.reportingCategory ?? null,
        transactionType: normalized.normalizedData?.transactionType ?? null,
      },
    });
    if (error) throw new Error(`Atlas economic event write failed: ${error.message}`);
    const eventId = String(data?.economicEventId ?? "");
    if (!eventId) throw new Error("Atlas did not return an economic event id.");

    const link = await admin.rpc("link_financial_observation_to_event_core_v1", {
      p_organization_id: organizationId,
      p_economic_event_id: eventId,
      p_observation_id: observationId,
      p_evidence_role: "establishes",
      p_admission_kind: "stripe_financial_adapter_v1",
      p_admission_ref: `balance_transaction:${normalized.providerRecordId}:${candidate.eventKind}`,
      p_confidence: 1,
      p_metadata: { provider: "stripe" },
    });
    if (link.error) throw new Error(`Atlas financial evidence link failed: ${link.error.message}`);
    eventIds.push(eventId);
    eventByKind.set(candidate.eventKind, eventId);
  }

  const paymentEventId = eventByKind.get("customer_payment");
  const feeEventId = eventByKind.get("processor_fee");
  if (paymentEventId && feeEventId) {
    const relation = await admin.rpc("relate_financial_economic_events_core_v1", {
      p_organization_id: organizationId,
      p_from_event_id: feeEventId,
      p_to_event_id: paymentEventId,
      p_relation_kind: "fee_on",
      p_admission_kind: "stripe_financial_adapter_v1",
      p_admission_ref: `balance_transaction:${normalized.providerRecordId}:fee_on_payment`,
      p_confidence: 1,
      p_metadata: { provider: "stripe" },
    });
    if (relation.error) throw new Error(`Atlas financial event relation failed: ${relation.error.message}`);
  }
  return eventIds;
}

async function corroborateBalanceEvent(
  organizationId: string,
  sourceId: string,
  observationId: string,
  normalized: FinancialObservation,
) {
  const balanceTransactionId = normalized.normalizedData?.balanceTransactionId;
  if (typeof balanceTransactionId !== "string" || !balanceTransactionId) return [];
  const eventKind = normalized.providerRecordKind === "charge"
    ? "customer_payment"
    : normalized.providerRecordKind === "refund"
      ? "refund"
      : normalized.providerRecordKind === "payout"
        ? "payout"
        : null;
  if (!eventKind) return [];

  const admin = createAtlasAdminClient();
  const eventKey = balanceEventKey(sourceId, balanceTransactionId, eventKind);
  const { data: event, error } = await admin
    .from("financial_economic_events")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("event_key", eventKey)
    .maybeSingle();
  if (error) throw new Error(`Atlas economic event lookup failed: ${error.message}`);
  if (!event?.id) return [];

  const link = await admin.rpc("link_financial_observation_to_event_core_v1", {
    p_organization_id: organizationId,
    p_economic_event_id: event.id,
    p_observation_id: observationId,
    p_evidence_role: "corroborates",
    p_admission_kind: "stripe_stable_balance_transaction_link_v1",
    p_admission_ref: `${normalized.providerRecordKind}:${normalized.providerRecordId}:balance_transaction:${balanceTransactionId}`,
    p_confidence: 1,
    p_metadata: { provider: "stripe", stableStripeLink: true },
  });
  if (link.error) throw new Error(`Atlas financial corroboration link failed: ${link.error.message}`);
  return [String(event.id)];
}

export async function ingestStripeFinancialObject(
  organizationId: string,
  sourceId: string,
  raw: Record<string, unknown>,
  providerEventId: string | null = null,
): Promise<SyncRecordResult> {
  const { normalized, observationId } = await recordObservation(organizationId, sourceId, raw, providerEventId);
  const established = await ensureBalanceEconomicEvents(organizationId, sourceId, observationId, normalized);
  const corroborated = await corroborateBalanceEvent(organizationId, sourceId, observationId, normalized);
  return {
    observationId,
    normalized,
    economicEventIds: [...new Set([...established, ...corroborated])],
  };
}

const STRIPE_FINANCIAL_LISTS = {
  balance_transaction: { path: "balance_transactions", params: {} },
  charge: { path: "charges", params: {} },
  refund: { path: "refunds", params: {} },
  payout: { path: "payouts", params: {} },
  invoice: { path: "invoices", params: { status: "all" } },
} as const;

export type StripeFinancialListKind = keyof typeof STRIPE_FINANCIAL_LISTS;

export async function syncStripeFinancialSourcePage({
  organizationId,
  sourceId,
  accessToken,
  kind,
  startingAfter,
  limit = 100,
}: {
  organizationId: string;
  sourceId: string;
  accessToken: string;
  kind: StripeFinancialListKind;
  startingAfter?: string | null;
  limit?: number;
}) {
  const config = STRIPE_FINANCIAL_LISTS[kind];
  if (!config) throw new Error(`Unsupported Stripe financial list kind: ${kind}.`);
  const page = await stripeApiGet<{ data?: Record<string, unknown>[]; has_more?: boolean }>(
    accessToken,
    config.path,
    { ...config.params, limit: Math.max(1, Math.min(limit, 100)), starting_after: startingAfter || undefined },
  );
  const records = Array.isArray(page.data) ? page.data : [];
  const results: SyncRecordResult[] = [];
  // Balance transactions should be synced before charge/refund/payout pages so
  // stable Stripe balance_transaction IDs can immediately create corroboration links.
  for (const raw of records) {
    results.push(await ingestStripeFinancialObject(organizationId, sourceId, raw));
  }
  return {
    kind,
    count: records.length,
    hasMore: Boolean(page.has_more),
    nextStartingAfter: page.has_more && records.length ? String(records.at(-1)?.id ?? "") || null : null,
    results,
  };
}

export async function markStripeSourceSynced(sourceId: string) {
  const admin = createAtlasAdminClient();
  const { data, error } = await admin.rpc("mark_connected_source_provider_state_core_v1", {
    p_connected_source_id: sourceId,
    p_to_state: "connected",
    p_reason: "Stripe financial source synchronization completed.",
    p_last_sync_at: new Date().toISOString(),
    p_metadata: { provider: "stripe", financialObservation: true },
  });
  if (error) throw new Error(`Atlas Stripe source sync-state update failed: ${error.message}`);
  return data;
}

export function stripeRawPayloadSha256(rawBody: string | Buffer) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export async function recordStripeDelivery(
  sourceId: string,
  event: { id: string; type: string; created?: number },
  rawBody: string,
) {
  const admin = createAtlasAdminClient();
  const { data, error } = await admin.rpc("record_financial_source_delivery_core_v1", {
    p_connected_source_id: sourceId,
    p_provider_event_id: event.id,
    p_provider_event_kind: event.type,
    p_payload_sha256: stripeRawPayloadSha256(rawBody),
    p_provider_created_at: typeof event.created === "number" ? new Date(event.created * 1000).toISOString() : null,
    p_metadata: { provider: "stripe", delivery: "webhook" },
  });
  if (error) throw new Error(`Atlas Stripe delivery custody failed: ${error.message}`);
  return data as { deliveryEventId?: string; alreadySucceeded?: boolean; state?: string } | null;
}

export async function recordStripeDeliveryOutcome(
  deliveryEventId: string,
  processingKind: "succeeded" | "failed" | "ignored",
  detail: Record<string, unknown>,
) {
  const admin = createAtlasAdminClient();
  const { data, error } = await admin.rpc("record_financial_source_delivery_processing_core_v1", {
    p_delivery_event_id: deliveryEventId,
    p_processing_kind: processingKind,
    p_processor_contract: "stripe_financial_webhook_v1",
    p_detail: detail,
  });
  if (error) throw new Error(`Atlas Stripe delivery outcome write failed: ${error.message}`);
  return data;
}

export async function resolveStripeConnectedSourceByAccount(stripeAccountId: string) {
  const admin = createAtlasAdminClient();
  const { data, error } = await admin
    .from("connected_sources")
    .select("id,custodian_organization_id,authorization_state,capabilities")
    .eq("provider_key", "stripe")
    .eq("provider_account_key", stripeAccountId)
    .eq("authorization_state", "connected");
  if (error) throw new Error(`Atlas Stripe connected source lookup failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length !== 1) {
    throw new Error(rows.length === 0
      ? "No connected Atlas Stripe source matches this provider account."
      : "Stripe provider account identity is ambiguous across Atlas organizations.");
  }
  const row = rows[0];
  const capabilities = row.capabilities && typeof row.capabilities === "object" ? row.capabilities as Record<string, unknown> : {};
  if (capabilities.financialObservation !== true) {
    throw new Error("Connected Stripe source is not authorized for financial observation.");
  }
  return {
    sourceId: String(row.id),
    organizationId: String(row.custodian_organization_id),
  };
}

export function supportedStripeWebhookObject(event: Record<string, unknown>) {
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : null;
  const object = data?.object && typeof data.object === "object" ? data.object as Record<string, unknown> : null;
  return object && ["balance_transaction", "charge", "refund", "payout", "invoice"].includes(String(object.object))
    ? object
    : null;
}
