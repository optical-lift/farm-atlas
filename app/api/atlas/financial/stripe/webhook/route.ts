import { NextRequest, NextResponse } from "next/server";

import { verifyStripeWebhookSignature } from "@/lib/atlas/financial/stripe-security-core.js";
import {
  ingestStripeFinancialObject,
  readStripeSourceAccessToken,
  recordStripeDelivery,
  recordStripeDeliveryOutcome,
  resolveStripeConnectedSourceByAccount,
  stripeApiGet,
  supportedStripeWebhookObject,
} from "@/lib/atlas/financial/stripe-server";

export const dynamic = "force-dynamic";

function response(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function webhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET.");
  return secret;
}

function stripeId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

async function hydrateBalanceTransaction(
  organizationId: string,
  sourceId: string,
  accessToken: string,
  object: Record<string, unknown>,
  providerEventId: string,
) {
  const balanceTransactionId = stripeId(object.balance_transaction);
  if (!balanceTransactionId) return;
  const balance = await stripeApiGet<Record<string, unknown>>(
    accessToken,
    `balance_transactions/${encodeURIComponent(balanceTransactionId)}`,
  );
  await ingestStripeFinancialObject(organizationId, sourceId, balance, providerEventId);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  let verified;
  try {
    verified = verifyStripeWebhookSignature({
      rawBody,
      signatureHeader: signature,
      webhookSecret: webhookSecret(),
    });
  } catch {
    return response(503, { ok: false, error: "stripe_webhook_not_configured" });
  }
  if (!verified.ok) return response(400, { ok: false, error: verified.error });

  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    event = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return response(400, { ok: false, error: "invalid_json" });
  }

  const eventId = typeof event.id === "string" ? event.id : "";
  const eventType = typeof event.type === "string" ? event.type : "";
  const stripeAccountId = typeof event.account === "string" ? event.account : "";
  if (!eventId || !eventType || !stripeAccountId) {
    // Atlas deliberately requires the Connect account identity. A platform-level
    // event with no connected account may not nominate an Atlas organization.
    return response(400, { ok: false, error: "connected_stripe_event_identity_required" });
  }

  let deliveryEventId: string | null = null;
  try {
    const source = await resolveStripeConnectedSourceByAccount(stripeAccountId);
    const delivery = await recordStripeDelivery(source.sourceId, {
      id: eventId,
      type: eventType,
      created: typeof event.created === "number" ? event.created : undefined,
    }, rawBody);
    deliveryEventId = typeof delivery?.deliveryEventId === "string" ? delivery.deliveryEventId : null;
    if (!deliveryEventId) throw new Error("Atlas did not return provider delivery identity.");
    if (delivery?.alreadySucceeded) return response(200, { ok: true, duplicate: true });

    const object = supportedStripeWebhookObject(event);
    if (!object) {
      await recordStripeDeliveryOutcome(deliveryEventId, "ignored", {
        eventType,
        reason: "event_object_not_in_financial_adapter_v1",
      });
      return response(200, { ok: true, ignored: true });
    }

    const accessToken = await readStripeSourceAccessToken(source.sourceId);
    // Charge/refund/payout objects point to the stable balance transaction that
    // decomposes gross/fee/net. Ingest that evidence first so the object can
    // corroborate the already-established movement instead of becoming a second
    // independent payment/deposit.
    if (["charge", "refund", "payout"].includes(String(object.object))) {
      await hydrateBalanceTransaction(
        source.organizationId,
        source.sourceId,
        accessToken,
        object,
        eventId,
      );
    }
    const ingested = await ingestStripeFinancialObject(
      source.organizationId,
      source.sourceId,
      object,
      eventId,
    );
    await recordStripeDeliveryOutcome(deliveryEventId, "succeeded", {
      eventType,
      providerRecordKind: ingested.normalized.providerRecordKind,
      providerRecordId: ingested.normalized.providerRecordId,
      observationId: ingested.observationId,
      economicEventIds: ingested.economicEventIds,
    });
    return response(200, { ok: true });
  } catch (error) {
    if (deliveryEventId) {
      try {
        await recordStripeDeliveryOutcome(deliveryEventId, "failed", {
          eventType,
          detail: error instanceof Error ? error.message.slice(0, 240) : "unknown",
        });
      } catch {
        // Stripe should retry because the original processing path failed.
      }
    }
    return response(500, {
      ok: false,
      error: "stripe_webhook_processing_failed",
    });
  }
}
