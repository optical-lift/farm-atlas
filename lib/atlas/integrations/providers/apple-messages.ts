import {
  assertSourceEnvelope,
  type ConnectedSourceDescriptor,
  type IntegrationSourceEnvelope,
} from "../contract";

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

/**
 * Compatibility bridge for the already-operational macOS Messages relay.
 *
 * This does not replace the communication ledger or reinterpret its events.
 * It wraps the existing evidence-only event in the provider-neutral integration
 * envelope so Apple Messages and future providers can share custody,
 * idempotency, sync-health, and portability rules.
 */
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
