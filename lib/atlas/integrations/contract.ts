export type IntegrationProviderKey = string;

export type IntegrationCustody =
  | { kind: "human"; userId: string; organizationId?: never }
  | { kind: "organization"; organizationId: string; userId?: never };

export type IntegrationAuthorizationState =
  | "pending"
  | "connected"
  | "reauthorization_required"
  | "revoked"
  | "error";

export type IntegrationTransport =
  | "oauth2"
  | "api_key"
  | "webhook"
  | "event_stream"
  | "scheduled_sync"
  | "relay"
  | "manual_import";

export type IntegrationAuthority = "evidence_only" | "domain_adapter_required";

export type IntegrationCapability =
  | "calendar"
  | "communication"
  | "contacts"
  | "files"
  | "finance"
  | "forms"
  | "commerce"
  | "location"
  | "custom";

export interface ConnectedSourceDescriptor {
  sourceId: string;
  providerKey: IntegrationProviderKey;
  providerAccountKey: string;
  displayLabel?: string | null;
  accountHint?: string | null;
  custody: IntegrationCustody;
  authorizationState: IntegrationAuthorizationState;
  grantedScopes: readonly string[];
  capabilities: readonly IntegrationCapability[];
  lastSyncAt?: string | null;
}

/**
 * A reference to secret material, never the material itself.
 *
 * This value is suitable for application configuration because it contains only
 * the name/locator of a secret in the runtime's secret facility. Access tokens,
 * refresh tokens, API keys, webhook signing secrets, private keys, passwords,
 * and bearer tokens must never be assigned here.
 */
export interface IntegrationSecretHandle {
  secretRef: string;
  purpose:
    | "oauth_client"
    | "oauth_connection"
    | "api_credential"
    | "webhook_verification"
    | "relay_authentication"
    | "other";
}

export interface IntegrationSourceTime {
  /** Time the provider says the event/action occurred. */
  occurredAt?: string | null;
  /** Time the underlying state was observed, if distinct from occurrence. */
  observedAt?: string | null;
  /** Start of the interval in which the source says the fact applies. */
  effectiveFrom?: string | null;
  /** End of the interval in which the source says the fact applies. */
  effectiveUntil?: string | null;
  /** Time Atlas received this envelope. */
  receivedAt: string;
}

export interface IntegrationSourceEnvelope<TPayload = unknown> {
  schemaVersion: 1;
  providerKey: IntegrationProviderKey;
  connectedSourceId: string;
  providerAccountKey: string;
  custody: IntegrationCustody;

  /** Provider event/object id when one exists. */
  sourceEventRef: string;
  /** Deterministic Atlas key used to make provider retries replay-safe. */
  idempotencyKey: string;
  /** SHA-256 (hex) of the source representation admitted into custody. */
  sourceContentSha256: string;

  transport: IntegrationTransport;
  authority: IntegrationAuthority;
  capability: IntegrationCapability;
  time: IntegrationSourceTime;

  /**
   * Source-shaped data. It is evidence input, not canonical Atlas domain state.
   * Provider adapters should keep this payload minimal and provenance-preserving.
   */
  payload: TPayload;

  metadata?: Readonly<Record<string, unknown>>;
}

export interface IntegrationEvidenceDraft<TValue = unknown> {
  scopeKind: "human" | "organization";
  scopeId: string;
  subjectDomain: string;
  subjectKind: string;
  subjectId: string;
  evidenceKind: string;
  sourceKind: "connected_source";
  sourceKey: string;
  value: TValue;
  confidence?: number | null;
  observedAt?: string | null;
  learnedAt: string;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  provenance: Readonly<{
    providerKey: string;
    connectedSourceId: string;
    providerAccountKey: string;
    sourceEventRef: string;
    sourceContentSha256: string;
    idempotencyKey: string;
    transport: IntegrationTransport;
  }>;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface IntegrationSyncCheckpoint {
  connectedSourceId: string;
  providerKey: IntegrationProviderKey;
  checkpointKind: "cursor" | "page_token" | "watermark" | "window" | "none";
  opaqueValue?: string | null;
  coveredFrom?: string | null;
  coveredThrough?: string | null;
}

export interface IntegrationSyncHealth {
  connectedSourceId: string;
  authorizationState: IntegrationAuthorizationState;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  coverage?: Readonly<{
    from?: string | null;
    through?: string | null;
    complete: boolean;
  }>;
  checkpoint?: IntegrationSyncCheckpoint | null;
  latestError?: Readonly<{
    code: string;
    message: string;
    occurredAt: string;
    retryable: boolean;
  }> | null;
}

export interface IntegrationIngestResult {
  connectedSourceId: string;
  sourceEventRef: string;
  idempotencyKey: string;
  disposition: "admitted" | "already_in_custody" | "conflict" | "rejected";
  evidenceIds: readonly string[];
  domainWrites: readonly {
    domain: string;
    recordId: string;
    authorityBoundary: string;
  }[];
}

export function assertIntegrationCustody(custody: IntegrationCustody): void {
  if (custody.kind === "human") {
    if (!custody.userId) throw new Error("Human integration custody requires userId.");
    return;
  }
  if (!custody.organizationId) {
    throw new Error("Organization integration custody requires organizationId.");
  }
}

export function assertSourceEnvelope(envelope: IntegrationSourceEnvelope): void {
  assertIntegrationCustody(envelope.custody);

  if (envelope.schemaVersion !== 1) throw new Error("Unsupported integration envelope version.");
  if (!envelope.providerKey.trim()) throw new Error("providerKey is required.");
  if (!envelope.connectedSourceId.trim()) throw new Error("connectedSourceId is required.");
  if (!envelope.providerAccountKey.trim()) throw new Error("providerAccountKey is required.");
  if (!envelope.sourceEventRef.trim()) throw new Error("sourceEventRef is required.");
  if (!envelope.idempotencyKey.trim()) throw new Error("idempotencyKey is required.");
  if (!/^[0-9a-f]{64}$/.test(envelope.sourceContentSha256)) {
    throw new Error("sourceContentSha256 must be a lowercase SHA-256 hex digest.");
  }
  if (envelope.authority !== "evidence_only" && envelope.authority !== "domain_adapter_required") {
    throw new Error("Integration capture cannot claim governing domain authority directly.");
  }
  if (!envelope.time.receivedAt) throw new Error("receivedAt is required.");
}
