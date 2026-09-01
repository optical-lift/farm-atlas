import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  buildStripeOAuthAuthorizeUrl,
  createStripeOAuthState,
  normalizeStripeBalanceTransaction,
  normalizeStripeCharge,
  normalizeStripeInvoice,
  normalizeStripePayout,
  normalizeStripeRefund,
  stripeBalanceEventCandidates,
  stripeCurrencyMinorUnitExponent,
  stripeMinorAmountToDecimal,
  stripeObservationFingerprint,
  verifyStripeOAuthState,
  verifyStripeWebhookSignature,
} from "../lib/atlas/financial/stripe-core.js";

test("Stripe API minor units preserve zero-decimal and two-decimal currency behavior", () => {
  assert.equal(stripeCurrencyMinorUnitExponent("usd"), 2);
  assert.equal(stripeMinorAmountToDecimal(1099, "usd"), 10.99);
  assert.equal(stripeCurrencyMinorUnitExponent("jpy"), 0);
  assert.equal(stripeMinorAmountToDecimal(1099, "jpy"), 1099);
  // Stripe documents backward-compatible two-decimal API amounts for ISK/UGX.
  assert.equal(stripeCurrencyMinorUnitExponent("isk"), 2);
  assert.equal(stripeCurrencyMinorUnitExponent("ugx"), 2);
});

test("balance transaction normalization preserves gross fee net and Stripe source identity", () => {
  const normalized = normalizeStripeBalanceTransaction({
    id: "txn_charge_1",
    object: "balance_transaction",
    amount: 100000,
    fee: 2930,
    net: 97070,
    currency: "usd",
    created: 1788270000,
    available_on: 1788356400,
    status: "available",
    type: "charge",
    reporting_category: "charge",
    source: "ch_1",
    description: "Invoice 184",
    fee_details: [{ type: "stripe_fee", amount: 2930, currency: "usd" }],
  });

  assert.equal(normalized.providerRecordKind, "balance_transaction");
  assert.equal(normalized.providerRecordId, "txn_charge_1");
  assert.equal(normalized.direction, "inflow");
  assert.equal(normalized.grossAmount, 1000);
  assert.equal(normalized.feeAmount, 29.3);
  assert.equal(normalized.netAmount, 970.7);
  assert.equal(normalized.normalizedData.sourceObjectId, "ch_1");
  assert.equal(normalized.normalizedData.signedAmountMinor, 100000);
  assert.equal(normalized.normalizedData.signedNetMinor, 97070);
});

test("Stripe charge and invoice preserve customer and document evidence without claiming revenue classification", () => {
  const charge = normalizeStripeCharge({
    id: "ch_184",
    object: "charge",
    amount: 100000,
    amount_refunded: 0,
    currency: "usd",
    created: 1788270000,
    paid: true,
    refunded: false,
    disputed: false,
    customer: "cus_jane",
    payment_intent: "pi_184",
    balance_transaction: "txn_charge_184",
    receipt_number: "RCPT-184",
    billing_details: { name: "Jane Smith", email: "jane@example.com" },
  });
  assert.equal(charge.counterpartyLabel, "Jane Smith");
  assert.equal(charge.documentNumber, "RCPT-184");
  assert.equal(charge.normalizedData.customerId, "cus_jane");
  assert.equal(charge.normalizedData.balanceTransactionId, "txn_charge_184");

  const invoice = normalizeStripeInvoice({
    id: "in_184",
    object: "invoice",
    number: "INV-184",
    currency: "usd",
    amount_due: 100000,
    amount_paid: 100000,
    amount_remaining: 0,
    subtotal: 100000,
    total: 100000,
    created: 1788260000,
    status: "paid",
    customer: "cus_jane",
    customer_name: "Jane Smith",
    customer_email: "jane@example.com",
  });
  assert.equal(invoice.direction, "noncash");
  assert.equal(invoice.documentNumber, "INV-184");
  assert.equal(invoice.grossAmount, 1000);
  assert.equal(invoice.netAmount, 1000);
});

test("refund is outflow and payout is transfer rather than revenue", () => {
  const refund = normalizeStripeRefund({
    id: "re_1",
    object: "refund",
    amount: 2500,
    currency: "usd",
    created: 1788270000,
    status: "succeeded",
    charge: "ch_1",
    payment_intent: "pi_1",
    balance_transaction: "txn_refund_1",
  });
  assert.equal(refund.direction, "outflow");
  assert.equal(refund.grossAmount, 25);

  const payout = normalizeStripePayout({
    id: "po_1",
    object: "payout",
    amount: 284617,
    currency: "usd",
    created: 1788270000,
    arrival_date: 1788442800,
    status: "paid",
    destination: "ba_1",
    balance_transaction: "txn_payout_1",
  });
  assert.equal(payout.direction, "transfer");
  assert.equal(payout.grossAmount, 2846.17);
  assert.equal(payout.normalizedData.destinationId, "ba_1");
});

test("observation fingerprint is stable across object key order and changes with evidence", () => {
  const a = stripeObservationFingerprint({ b: 2, a: { d: 4, c: 3 } });
  const b = stripeObservationFingerprint({ a: { c: 3, d: 4 }, b: 2 });
  const c = stripeObservationFingerprint({ a: { c: 3, d: 5 }, b: 2 });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("Stripe balance event candidates distinguish payment fee payout and never relabel payout as revenue", () => {
  const paymentObservation = normalizeStripeBalanceTransaction({
    id: "txn_payment",
    object: "balance_transaction",
    amount: 100000,
    fee: 2930,
    net: 97070,
    currency: "usd",
    created: 1788270000,
    available_on: 1788356400,
    status: "available",
    type: "charge",
    reporting_category: "charge",
    source: "ch_1",
    fee_details: [],
  });
  assert.deepEqual(
    stripeBalanceEventCandidates(paymentObservation).map((candidate) => candidate.eventKind),
    ["customer_payment", "processor_fee"],
  );

  const payoutObservation = normalizeStripeBalanceTransaction({
    id: "txn_payout",
    object: "balance_transaction",
    amount: -97070,
    fee: 0,
    net: -97070,
    currency: "usd",
    created: 1788270000,
    available_on: 1788270000,
    status: "available",
    type: "payout",
    reporting_category: "payout",
    source: "po_1",
    fee_details: [],
  });
  const candidates = stripeBalanceEventCandidates(payoutObservation);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].eventKind, "payout");
  assert.equal(candidates[0].direction, "transfer");
  assert.doesNotMatch(JSON.stringify(candidates), /revenue/i);
});

test("OAuth state is signed, user/org-bound, expires, and authorization requests read_only", () => {
  const secret = "state-secret-for-tests";
  const payload = {
    userId: "user-1",
    organizationId: "org-1",
    nonce: "nonce-1",
    expiresAt: 2_000_000,
  };
  const state = createStripeOAuthState(payload, secret);
  assert.deepEqual(verifyStripeOAuthState(state, secret, 1_000_000), { ok: true, payload });
  assert.equal(verifyStripeOAuthState(`${state}x`, secret, 1_000_000).ok, false);
  assert.deepEqual(verifyStripeOAuthState(state, secret, 3_000_000), { ok: false, error: "expired_state" });

  const url = new URL(buildStripeOAuthAuthorizeUrl({
    clientId: "ca_test",
    redirectUri: "https://atlas.example/api/atlas/financial/stripe/callback",
    state,
  }));
  assert.equal(url.origin, "https://connect.stripe.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "read_only");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), state);
});

test("webhook verification uses the exact raw body, accepts any matching v1, and enforces tolerance", () => {
  const secret = "whsec_test";
  const rawBody = '{"id":"evt_1","type":"balance.available"}';
  const timestamp = 1_788_270_000;
  const valid = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const header = `t=${timestamp},v1=deadbeef,v1=${valid}`;

  assert.deepEqual(verifyStripeWebhookSignature({
    rawBody,
    signatureHeader: header,
    webhookSecret: secret,
    nowSeconds: timestamp + 100,
  }), { ok: true, timestamp });

  assert.equal(verifyStripeWebhookSignature({
    rawBody: `${rawBody} `,
    signatureHeader: header,
    webhookSecret: secret,
    nowSeconds: timestamp + 100,
  }).ok, false);

  assert.deepEqual(verifyStripeWebhookSignature({
    rawBody,
    signatureHeader: header,
    webhookSecret: secret,
    nowSeconds: timestamp + 301,
    toleranceSeconds: 300,
  }), { ok: false, error: "timestamp_outside_tolerance" });
});
