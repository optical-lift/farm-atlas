import type { IntegrationEvidenceAdapter } from "../adapter";
import {
  assertSourceEnvelope,
  type ConnectedSourceDescriptor,
  type IntegrationEvidenceDraft,
  type IntegrationSourceEnvelope,
} from "../contract";
import {
  processIntegrationEnvelope,
  type IntegrationEvidenceCustody,
} from "../pipeline";

export interface LegacyAppleMessagesEvent {
  schemaVersion: "atlas_communication_event_v1";
  source: {
    kind: "apple_messages";
    accountRef: string;
    eventRef: string;
    threadRef?: string | null;
  };
  captureMode: string;
  sourceAuthority: "evidence_only";
  permittedStateEffect: "append_source_attributed_evidence_only";
  governingStateChanged: false;
  direction: "incoming" | "outgoing" | "unknown";
  speaker: {
    isSelf: boolean;
    address?: string | null;
  };
  occurredAt?: string | null;
  capturedAt: string;
  body?: string | null;
  bodyState: string;
  contentHash: string;
  sourcePayload: Readonly<Record<string, unknown>>;
}

export function assertLegacyAppleMessagesEvent(event: LegacyAppleMessagesEvent): void {
  if (event.schemaVersion !== "atlas_communication_event_v1") {
    throw new Error("Unsupported Apple Messages event schema.");
  }
  if (event.source.kind !== "apple_messages") {
    throw new Error("Apple Messages adapter received a non-Apple source.");
  }
  if (event.sourceAuthority !== "evidence_only") {
    throw new Error("Apple Messages capture must remain evidence-only.");
  }
  if (event.permittedStateEffect !== "append_source_attributed_evidence_only") {
    throw new Error("Apple Messages capture may only append source-attributed evidence.");
  }
  if (event.governingStateChanged !== false) {
    throw new Error("Apple Messages capture may not claim a governing state change.");
  }
  if (!event.source.eventRef?.trim()) {
    throw new Error("Apple Messages eventRef is required.");
  }
  if (!/^[0-9a-f]{64}$/.test(event.contentHash)) {
    throw new Error("Apple Messages contentHash must be a lowercase SHA-256 digest.");
  }
  if (!event.capturedAt) {
    throw new Error("Apple Messages capturedAt is required.");
  }
}

/** Compatibility bridge for the already-operational macOS Messages relay. */
export function appleMessagesEventToEnvelope(
  event: LegacyAppleMessagesEvent,
  source: ConnectedSourceDescriptor,
): IntegrationSourceEnvelope<LegacyAppleMessagesEvent> {
  assertLegacyAppleMessagesEvent(event);

  if (source.providerKey !== "apple_messages") {
    throw new Error("Connected source is not registered as apple_messages.");
  }
  if (source.providerAccountKey !== event.source.accountRef) {
    throw new Error("Apple Messages event accountRef does not match the connected source account.");
  }

  const envelope: IntegrationSourceEnvelope<LegacyAppleMessagesEvent> = {
    schemaVersion: 1,
    providerKey: "apple_messages",
    connectedSourceId: source.sourceId,
    providerAccountKey: source.providerAccountKey,
    custody: source.custody,
    sourceEventRef: event.source.eventRef,
    idempotencyKey: [
      "apple_messages",
      source.sourceId,
      event.source.eventRef,
      event.contentHash,
    ].join(":"),
    sourceContentSha256: event.contentHash,
    transport: "relay",
    authority: "evidence_only",
    capability: "communication",
    time: {
      occurredAt: event.occurredAt ?? null,
      observedAt: event.occurredAt ?? null,
      receivedAt: event.capturedAt,
    },
    payload: event,
    metadata: {
      captureMode: event.captureMode,
      threadRef: event.source.threadRef ?? null,
      direction: event.direction,
      bodyState: event.bodyState,
      legacySchemaVersion: event.schemaVersion,
    },
  };

  assertSourceEnvelope(envelope);
  return envelope;
}

function custodyScope(source: ConnectedSourceDescriptor["custody"]): {
  scopeKind: "human" | "organization";
  scopeId: string;
} {
  return source.kind === "human"
    ? { scopeKind: "human", scopeId: source.userId }
    : { scopeKind: "organization", scopeId: source.organizationId };
}

export function appleMessagesEnvelopeToEvidence(
  envelope: IntegrationSourceEnvelope<LegacyAppleMessagesEvent>,
): readonly IntegrationEvidenceDraft<LegacyAppleMessagesEvent>[] {
  assertSourceEnvelope(envelope);
  if (envelope.providerKey !== "apple_messages" || envelope.authority !== "evidence_only") {
    throw new Error("Apple Messages evidence normalization requires an evidence-only Apple envelope.");
  }

  const scope = custodyScope(envelope.custody);
  return [{
    ...scope,
    subjectDomain: "communication",
    subjectKind: "source_event",
    subjectId: envelope.sourceEventRef,
    evidenceKind: "communication_event",
    sourceKind: "connected_source",
    sourceKey: envelope.connectedSourceId,
    value: envelope.payload,
    observedAt: envelope.time.observedAt ?? null,
    learnedAt: envelope.time.receivedAt,
    effectiveFrom: envelope.time.effectiveFrom ?? null,
    effectiveUntil: envelope.time.effectiveUntil ?? null,
    provenance: {
      providerKey: envelope.providerKey,
      connectedSourceId: envelope.connectedSourceId,
      providerAccountKey: envelope.providerAccountKey,
      sourceEventRef: envelope.sourceEventRef,
      sourceContentSha256: envelope.sourceContentSha256,
      idempotencyKey: envelope.idempotencyKey,
      transport: envelope.transport,
    },
    metadata: envelope.metadata,
  }];
}

export const appleMessagesEvidenceAdapter: IntegrationEvidenceAdapter<LegacyAppleMessagesEvent> = {
  domain: "communication",
  async toEvidence(envelope) {
    return appleMessagesEnvelopeToEvidence(envelope);
  },
};

/**
 * End-to-end portable path for a legacy relay event. Apple Messages supplies no
 * domain adapter because its capture authority stops at source evidence custody.
 */
export async function processLegacyAppleMessagesEvent(
  event: LegacyAppleMessagesEvent,
  source: ConnectedSourceDescriptor,
  custody: IntegrationEvidenceCustody<LegacyAppleMessagesEvent>,
) {
  const envelope = appleMessagesEventToEnvelope(event, source);
  return processIntegrationEnvelope({
    envelope,
    evidenceAdapter: appleMessagesEvidenceAdapter,
    custody,
  });
}
