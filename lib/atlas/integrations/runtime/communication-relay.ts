import {
  assertSourceEnvelope,
  type IntegrationEvidenceCustodyReceipt,
  type IntegrationSourceEnvelope,
} from "../contract";

export interface LegacyCommunicationRelayReceipt {
  schemaVersion: "atlas_communication_ingest_receipt_v1";
  batchId?: string | null;
  connectedSourceId: string;
  sourceKind: string;
  sourceAccountRef: string;
  supplied: number;
  admitted: number;
  alreadyInCustody: number;
  sourceStateObservations?: number;
  conflicts: number;
  firstOccurredAt?: string | null;
  lastOccurredAt?: string | null;
  governingStateChanged: false;
}

export interface CommunicationEventIdentityResolution {
  eventId?: string | null;
}

function requireSingleOutcome(receipt: LegacyCommunicationRelayReceipt):
  | "admitted"
  | "already_in_custody"
  | "conflict" {
  if (receipt.supplied !== 1) {
    throw new Error("Legacy communication custody mapping requires a one-event relay batch.");
  }

  const outcomes = Number(receipt.admitted === 1)
    + Number(receipt.alreadyInCustody === 1)
    + Number(receipt.conflicts === 1);
  if (outcomes !== 1) {
    throw new Error("Legacy communication relay receipt must report exactly one custody outcome.");
  }
  if (receipt.admitted === 1) return "admitted";
  if (receipt.alreadyInCustody === 1) return "already_in_custody";
  return "conflict";
}

/**
 * Maps the existing communication relay batch receipt into the portable custody
 * contract when the runtime submits exactly one event. No database or HTTP
 * implementation is imported here.
 */
export function mapLegacyCommunicationRelayReceipt(
  envelope: IntegrationSourceEnvelope,
  receipt: LegacyCommunicationRelayReceipt,
  identity: CommunicationEventIdentityResolution = {},
): IntegrationEvidenceCustodyReceipt {
  assertSourceEnvelope(envelope);

  if (receipt.schemaVersion !== "atlas_communication_ingest_receipt_v1") {
    throw new Error("Unsupported communication relay receipt schema.");
  }
  if (receipt.connectedSourceId !== envelope.connectedSourceId) {
    throw new Error("Communication relay receipt connected source does not match the envelope.");
  }
  if (receipt.sourceKind !== envelope.providerKey) {
    throw new Error("Communication relay receipt source kind does not match the envelope provider.");
  }
  if (receipt.sourceAccountRef !== envelope.providerAccountKey) {
    throw new Error("Communication relay receipt account does not match the envelope account.");
  }
  if (receipt.governingStateChanged !== false) {
    throw new Error("Communication relay receipt may not claim a governing state change.");
  }

  const disposition = requireSingleOutcome(receipt);
  if ((disposition === "admitted" || disposition === "already_in_custody") && !identity.eventId) {
    throw new Error("Admitted or replayed communication evidence requires the resolved event id.");
  }

  return {
    connectedSourceId: envelope.connectedSourceId,
    sourceEventRef: envelope.sourceEventRef,
    idempotencyKey: envelope.idempotencyKey,
    disposition,
    evidenceIds: identity.eventId ? [identity.eventId] : [],
    reason: disposition === "conflict" ? "source_event_ref_content_conflict" : null,
  };
}
