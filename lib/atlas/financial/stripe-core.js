import { createHash } from "node:crypto";

// Stripe API amount fields use the currency's minor unit. These currencies use
// a zero-decimal API amount representation. ISK, HUF, TWD, and UGX deliberately
// remain two-decimal here because Stripe documents compatibility/special payout
// behavior for those currencies rather than a universally zero-decimal API shape.
const STRIPE_ZERO_DECIMAL_API_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unixSecondsToIso(value) {
  if (!Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

function signedDirection(value, fallback = "noncash") {
  if (!Number.isFinite(value) || value === 0) return fallback;
  return value > 0 ? "inflow" : "outflow";
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function stripeObservationFingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function stripeCurrencyMinorUnitExponent(currency) {
  const normalized = requireString(currency, "Stripe currency").toLowerCase();
  return STRIPE_ZERO_DECIMAL_API_CURRENCIES.has(normalized) ? 0 : 2;
}

export function stripeMinorAmountToDecimal(amount, currency) {
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Stripe amount must be a safe integer in minor units.");
  }
  const exponent = stripeCurrencyMinorUnitExponent(currency);
  return amount / 10 ** exponent;
}

function stripeId(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function baseObservation({
  providerRecordKind,
  providerRecordId,
  effectiveAt,
  direction,
  grossAmount,
  feeAmount,
  netAmount,
  currency,
  counterpartyLabel,
  documentNumber,
  description,
  providerState,
  normalizedData,
}) {
  const observation = {
    providerKey: "stripe",
    providerRecordKind,
    providerRecordId,
    effectiveAt,
    direction,
    grossAmount,
    feeAmount,
    netAmount,
    currency: currency?.toLowerCase() ?? null,
    counterpartyLabel: counterpartyLabel ?? null,
    documentNumber: documentNumber ?? null,
    description: description ?? null,
    providerState: providerState ?? null,
    normalizedData,
  };
  return {
    ...observation,
    observationFingerprint: stripeObservationFingerprint(observation),
  };
}

export function normalizeStripeBalanceTransaction(input) {
  const tx = requireObject(input, "Stripe balance transaction");
  const id = requireString(tx.id, "Stripe balance transaction id");
  if (tx.object && tx.object !== "balance_transaction") {
    throw new Error("Stripe object is not a balance transaction.");
  }
  const currency = requireString(tx.currency, "Stripe balance transaction currency").toLowerCase();
  if (!Number.isSafeInteger(tx.amount) || !Number.isSafeInteger(tx.fee) || !Number.isSafeInteger(tx.net)) {
    throw new Error("Stripe balance transaction amount, fee, and net must be integer minor units.");
  }
  const sourceObjectId = stripeId(tx.source);
  const direction = signedDirection(tx.net || tx.amount, "noncash");
  return baseObservation({
    providerRecordKind: "balance_transaction",
    providerRecordId: id,
    effectiveAt: unixSecondsToIso(tx.created),
    direction,
    grossAmount: Math.abs(stripeMinorAmountToDecimal(tx.amount, currency)),
    feeAmount: Math.abs(stripeMinorAmountToDecimal(tx.fee, currency)),
    netAmount: Math.abs(stripeMinorAmountToDecimal(tx.net, currency)),
    currency,
    description: optionalString(tx.description),
    providerState: optionalString(tx.status),
    normalizedData: {
      stripeObject: "balance_transaction",
      signedAmountMinor: tx.amount,
      feeMinor: tx.fee,
      signedNetMinor: tx.net,
      availableOn: unixSecondsToIso(tx.available_on),
      balanceType: optionalString(tx.balance_type),
      reportingCategory: optionalString(tx.reporting_category),
      transactionType: optionalString(tx.type),
      sourceObjectId,
      exchangeRate: Number.isFinite(tx.exchange_rate) ? tx.exchange_rate : null,
      feeDetails: Array.isArray(tx.fee_details) ? tx.fee_details : [],
    },
  });
}

export function normalizeStripeCharge(input) {
  const charge = requireObject(input, "Stripe charge");
  const id = requireString(charge.id, "Stripe charge id");
  const currency = requireString(charge.currency, "Stripe charge currency").toLowerCase();
  if (!Number.isSafeInteger(charge.amount)) throw new Error("Stripe charge amount must be integer minor units.");
  const amountRefunded = Number.isSafeInteger(charge.amount_refunded) ? charge.amount_refunded : 0;
  const customerId = stripeId(charge.customer);
  const billing = charge.billing_details && typeof charge.billing_details === "object" ? charge.billing_details : {};
  const counterpartyLabel = optionalString(billing.name) || optionalString(billing.email) || customerId;
  return baseObservation({
    providerRecordKind: "charge",
    providerRecordId: id,
    effectiveAt: unixSecondsToIso(charge.created),
    direction: "inflow",
    grossAmount: stripeMinorAmountToDecimal(charge.amount, currency),
    feeAmount: null,
    netAmount: stripeMinorAmountToDecimal(Math.max(charge.amount - amountRefunded, 0), currency),
    currency,
    counterpartyLabel,
    documentNumber: optionalString(charge.receipt_number),
    description: optionalString(charge.description),
    providerState: charge.refunded ? "refunded" : charge.paid ? "paid" : optionalString(charge.status),
    normalizedData: {
      stripeObject: "charge",
      amountMinor: charge.amount,
      amountRefundedMinor: amountRefunded,
      balanceTransactionId: stripeId(charge.balance_transaction),
      customerId,
      paymentIntentId: stripeId(charge.payment_intent),
      invoiceId: stripeId(charge.invoice),
      receiptNumber: optionalString(charge.receipt_number),
      disputed: Boolean(charge.disputed),
      paid: Boolean(charge.paid),
      refunded: Boolean(charge.refunded),
      billingEmail: optionalString(billing.email),
    },
  });
}

export function normalizeStripeRefund(input) {
  const refund = requireObject(input, "Stripe refund");
  const id = requireString(refund.id, "Stripe refund id");
  const currency = requireString(refund.currency, "Stripe refund currency").toLowerCase();
  if (!Number.isSafeInteger(refund.amount)) throw new Error("Stripe refund amount must be integer minor units.");
  return baseObservation({
    providerRecordKind: "refund",
    providerRecordId: id,
    effectiveAt: unixSecondsToIso(refund.created),
    direction: "outflow",
    grossAmount: stripeMinorAmountToDecimal(refund.amount, currency),
    feeAmount: null,
    netAmount: stripeMinorAmountToDecimal(refund.amount, currency),
    currency,
    description: optionalString(refund.reason),
    providerState: optionalString(refund.status),
    normalizedData: {
      stripeObject: "refund",
      amountMinor: refund.amount,
      chargeId: stripeId(refund.charge),
      paymentIntentId: stripeId(refund.payment_intent),
      balanceTransactionId: stripeId(refund.balance_transaction),
      reason: optionalString(refund.reason),
    },
  });
}

export function normalizeStripePayout(input) {
  const payout = requireObject(input, "Stripe payout");
  const id = requireString(payout.id, "Stripe payout id");
  const currency = requireString(payout.currency, "Stripe payout currency").toLowerCase();
  if (!Number.isSafeInteger(payout.amount)) throw new Error("Stripe payout amount must be integer minor units.");
  return baseObservation({
    providerRecordKind: "payout",
    providerRecordId: id,
    effectiveAt: unixSecondsToIso(payout.created),
    // A payout is movement from processor custody toward a bank account. It is
    // never admitted as revenue merely because it eventually appears as a deposit.
    direction: "transfer",
    grossAmount: Math.abs(stripeMinorAmountToDecimal(payout.amount, currency)),
    feeAmount: null,
    netAmount: Math.abs(stripeMinorAmountToDecimal(payout.amount, currency)),
    currency,
    description: optionalString(payout.description),
    providerState: optionalString(payout.status),
    normalizedData: {
      stripeObject: "payout",
      amountMinor: payout.amount,
      arrivalDate: unixSecondsToIso(payout.arrival_date),
      automatic: payout.automatic ?? null,
      destinationId: stripeId(payout.destination),
      method: optionalString(payout.method),
      payoutType: optionalString(payout.type),
      statementDescriptor: optionalString(payout.statement_descriptor),
      balanceTransactionId: stripeId(payout.balance_transaction),
      traceId: optionalString(payout.trace_id) || optionalString(payout.payout_trace_id),
    },
  });
}

export function normalizeStripeInvoice(input) {
  const invoice = requireObject(input, "Stripe invoice");
  const id = requireString(invoice.id, "Stripe invoice id");
  const currency = requireString(invoice.currency, "Stripe invoice currency").toLowerCase();
  const amountDue = Number.isSafeInteger(invoice.amount_due) ? invoice.amount_due : 0;
  const amountPaid = Number.isSafeInteger(invoice.amount_paid) ? invoice.amount_paid : 0;
  const customerId = stripeId(invoice.customer);
  return baseObservation({
    providerRecordKind: "invoice",
    providerRecordId: id,
    effectiveAt: unixSecondsToIso(invoice.created),
    direction: "noncash",
    grossAmount: stripeMinorAmountToDecimal(Math.abs(amountDue), currency),
    feeAmount: null,
    netAmount: stripeMinorAmountToDecimal(Math.abs(amountPaid), currency),
    currency,
    counterpartyLabel: optionalString(invoice.customer_name) || optionalString(invoice.customer_email) || customerId,
    documentNumber: optionalString(invoice.number),
    description: optionalString(invoice.description),
    providerState: optionalString(invoice.status),
    normalizedData: {
      stripeObject: "invoice",
      number: optionalString(invoice.number),
      customerId,
      customerEmail: optionalString(invoice.customer_email),
      amountDueMinor: amountDue,
      amountPaidMinor: amountPaid,
      amountRemainingMinor: Number.isSafeInteger(invoice.amount_remaining) ? invoice.amount_remaining : null,
      subtotalMinor: Number.isSafeInteger(invoice.subtotal) ? invoice.subtotal : null,
      totalMinor: Number.isSafeInteger(invoice.total) ? invoice.total : null,
      dueDate: unixSecondsToIso(invoice.due_date),
      statusTransitions: invoice.status_transitions ?? null,
    },
  });
}

export function normalizeStripeFinancialObject(input) {
  const value = requireObject(input, "Stripe object");
  switch (value.object) {
    case "balance_transaction":
      return normalizeStripeBalanceTransaction(value);
    case "charge":
      return normalizeStripeCharge(value);
    case "refund":
      return normalizeStripeRefund(value);
    case "payout":
      return normalizeStripePayout(value);
    case "invoice":
      return normalizeStripeInvoice(value);
    default:
      throw new Error(`Unsupported Stripe financial object: ${value.object ?? "unknown"}.`);
  }
}

export function stripeBalanceEventCandidates(observation) {
  requireObject(observation, "Stripe observation");
  if (observation.providerRecordKind !== "balance_transaction") return [];
  const data = observation.normalizedData ?? {};
  const candidates = [];
  if (data.transactionType === "payout" || data.reportingCategory === "payout") {
    candidates.push({
      eventKind: "payout",
      direction: "transfer",
      amount: observation.netAmount,
      currency: observation.currency,
      authorityKind: "stripe_balance_transaction",
      note: "Processor-to-bank movement; never revenue by itself.",
    });
  } else if (data.transactionType === "stripe_fee" || data.transactionType === "stripe_fx_fee") {
    candidates.push({
      eventKind: "processor_fee",
      direction: "outflow",
      amount: observation.netAmount || observation.grossAmount,
      currency: observation.currency,
      authorityKind: "stripe_balance_transaction",
    });
  } else if (["charge", "payment"].includes(data.transactionType)) {
    candidates.push({
      eventKind: "customer_payment",
      direction: "inflow",
      amount: observation.grossAmount,
      currency: observation.currency,
      authorityKind: "stripe_balance_transaction",
      note: "Payment evidence only; revenue recognition remains domain/accounting-owned.",
    });
    if (observation.feeAmount > 0) {
      candidates.push({
        eventKind: "processor_fee",
        direction: "outflow",
        amount: observation.feeAmount,
        currency: observation.currency,
        authorityKind: "stripe_balance_transaction_fee_component",
      });
    }
  } else if (["refund", "payment_refund", "payment_reversal"].includes(data.transactionType)) {
    candidates.push({
      eventKind: "refund",
      direction: "outflow",
      amount: observation.grossAmount,
      currency: observation.currency,
      authorityKind: "stripe_balance_transaction",
    });
  }
  return candidates;
}
