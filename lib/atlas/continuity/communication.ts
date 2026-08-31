export const ATLAS_COMMUNICATION_EVENT_VERSION = "atlas_communication_event_v1" as const;
export const ATLAS_COMMUNICATION_MANIFEST_VERSION = "atlas_communication_manifest_v1" as const;

export const ATLAS_COMMUNICATION_SOURCE_KINDS = [
  "apple_messages",
  "sms",
  "email",
  "whatsapp",
  "slack",
  "teams",
  "crm_message",
  "call_transcript",
  "manual_capture",
] as const;

export const ATLAS_COMMUNICATION_CAPTURE_MODES = [
  "historical_backfill",
  "live_capture",
  "authoritative_reconciliation",
  "manual_capture",
] as const;

export const ATLAS_COMMUNICATION_BODY_STATES = [
  "exact_text",
  "attributed_body_preserved",
  "empty",
] as const;

export type AtlasCommunicationSourceKind = (typeof ATLAS_COMMUNICATION_SOURCE_KINDS)[number];
export type AtlasCommunicationCaptureMode = (typeof ATLAS_COMMUNICATION_CAPTURE_MODES)[number];
export type AtlasCommunicationBodyState = (typeof ATLAS_COMMUNICATION_BODY_STATES)[number];
export type AtlasCommunicationDirection = "incoming" | "outgoing" | "unknown";

export type AtlasCommunicationSourceRef = {
  kind: AtlasCommunicationSourceKind;
  accountRef: string;
  eventRef: string;
  threadRef: string | null;
};

export type AtlasCommunicationSpeakerRef = {
  isSelf: boolean;
  address: string | null;
};

export type AtlasCommunicationEventV1 = {
  schemaVersion: typeof ATLAS_COMMUNICATION_EVENT_VERSION;
  source: AtlasCommunicationSourceRef;
  captureMode: AtlasCommunicationCaptureMode;
  sourceAuthority: "evidence_only";
  permittedStateEffect: "append_source_attributed_evidence_only";
  governingStateChanged: false;
  direction: AtlasCommunicationDirection;
  speaker: AtlasCommunicationSpeakerRef;
  occurredAt: string | null;
  capturedAt: string;
  body: string | null;
  bodyState: AtlasCommunicationBodyState;
  contentHash: string;
  sourcePayload: Record<string, string | number | boolean | null>;
};

export type AtlasCommunicationCustodyManifestV1 = {
  schemaVersion: typeof ATLAS_COMMUNICATION_MANIFEST_VERSION;
  sourceKind: AtlasCommunicationSourceKind;
  captureMode: AtlasCommunicationCaptureMode;
  sourceAccountRef: string;
  capturedAt: string;
  sourceDatabasePath: string;
  sourceReadOnly: true;
  eventCount: number;
  firstOccurredAt: string | null;
  lastOccurredAt: string | null;
  exportSha256: string;
  exportPath: string;
};

/**
 * Communication evidence may inform later Atlas interpretation, but this layer
 * never promotes a message into a task, directive, completion, priority change,
 * financial action, calendar mutation, CRM mutation, or other governing state.
 */
export function isSourceAttributedCommunicationEvidence(
  event: AtlasCommunicationEventV1,
): boolean {
  return event.sourceAuthority === "evidence_only"
    && event.permittedStateEffect === "append_source_attributed_evidence_only"
    && event.governingStateChanged === false;
}
