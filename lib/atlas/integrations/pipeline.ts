import type {
  IntegrationDomainAdapter,
  IntegrationEvidenceAdapter,
} from "./adapter";
import {
  assertSourceEnvelope,
  type IntegrationDomainPromotionResult,
  type IntegrationEvidenceCustodyReceipt,
  type IntegrationEvidenceDraft,
  type IntegrationIngestResult,
  type IntegrationSourceEnvelope,
} from "./contract";

/**
 * Runtime-specific evidence persistence boundary.
 *
 * Implementations may write to the governed Atlas evidence ledger, but this
 * portable interface deliberately says nothing about a hosting vendor, HTTP, or UI.
 */
export interface IntegrationEvidenceCustody<TPayload = unknown> {
  admit(
    envelope: IntegrationSourceEnvelope<TPayload>,
    evidence: readonly IntegrationEvidenceDraft[],
  ): Promise<IntegrationEvidenceCustodyReceipt>;
}

export interface ProcessIntegrationEnvelopeRequest<TPayload = unknown> {
  envelope: IntegrationSourceEnvelope<TPayload>;
  evidenceAdapter: IntegrationEvidenceAdapter<TPayload>;
  custody: IntegrationEvidenceCustody<TPayload>;
  domainAdapter?: IntegrationDomainAdapter<TPayload> | null;
}

function assertReceiptIdentity(
  envelope: IntegrationSourceEnvelope,
  receipt: Pick<IntegrationEvidenceCustodyReceipt, "connectedSourceId" | "sourceEventRef" | "idempotencyKey">,
  label: string,
): void {
  if (receipt.connectedSourceId !== envelope.connectedSourceId) {
    throw new Error(`${label} connectedSourceId does not match the source envelope.`);
  }
  if (receipt.sourceEventRef !== envelope.sourceEventRef) {
    throw new Error(`${label} sourceEventRef does not match the source envelope.`);
  }
  if (receipt.idempotencyKey !== envelope.idempotencyKey) {
    throw new Error(`${label} idempotencyKey does not match the source envelope.`);
  }
}

function assertPromotionIdentity(
  envelope: IntegrationSourceEnvelope,
  promotion: IntegrationDomainPromotionResult,
): void {
  assertReceiptIdentity(envelope, promotion, "Domain promotion result");
  for (const write of promotion.domainWrites) {
    if (!write.domain.trim()) throw new Error("Domain promotion write requires domain.");
    if (!write.recordId.trim()) throw new Error("Domain promotion write requires recordId.");
    if (!write.authorityBoundary.trim()) {
      throw new Error("Domain promotion write requires an explicit authorityBoundary.");
    }
  }
}

/**
 * Admit evidence before any canonical promotion can occur.
 *
 * Replay, conflict, and rejection dispositions terminate here. Evidence-only
 * sources also terminate here by construction.
 */
export async function processIntegrationEnvelope<TPayload>(
  request: ProcessIntegrationEnvelopeRequest<TPayload>,
): Promise<IntegrationIngestResult> {
  const { envelope, evidenceAdapter, custody, domainAdapter = null } = request;
  assertSourceEnvelope(envelope);

  const evidence = await evidenceAdapter.toEvidence(envelope);
  const receipt = await custody.admit(envelope, evidence);
  assertReceiptIdentity(envelope, receipt, "Evidence custody receipt");

  if (receipt.disposition !== "admitted") {
    return {
      connectedSourceId: envelope.connectedSourceId,
      sourceEventRef: envelope.sourceEventRef,
      idempotencyKey: envelope.idempotencyKey,
      disposition: receipt.disposition,
      evidenceIds: receipt.evidenceIds,
      domainPromotion: "not_attempted",
      domainWrites: [],
    };
  }

  if (envelope.authority === "evidence_only") {
    return {
      connectedSourceId: envelope.connectedSourceId,
      sourceEventRef: envelope.sourceEventRef,
      idempotencyKey: envelope.idempotencyKey,
      disposition: receipt.disposition,
      evidenceIds: receipt.evidenceIds,
      domainPromotion: "not_authorized",
      domainWrites: [],
    };
  }

  if (!domainAdapter) {
    return {
      connectedSourceId: envelope.connectedSourceId,
      sourceEventRef: envelope.sourceEventRef,
      idempotencyKey: envelope.idempotencyKey,
      disposition: receipt.disposition,
      evidenceIds: receipt.evidenceIds,
      domainPromotion: "awaiting_domain_adapter",
      domainWrites: [],
    };
  }

  if (domainAdapter.domain !== evidenceAdapter.domain) {
    throw new Error("Evidence adapter and domain adapter must declare the same domain.");
  }

  const promotion = await domainAdapter.promote(envelope, evidence, receipt.evidenceIds);
  assertPromotionIdentity(envelope, promotion);

  return {
    connectedSourceId: envelope.connectedSourceId,
    sourceEventRef: envelope.sourceEventRef,
    idempotencyKey: envelope.idempotencyKey,
    disposition: receipt.disposition,
    evidenceIds: receipt.evidenceIds,
    domainPromotion: "promoted",
    domainWrites: promotion.domainWrites,
  };
}
