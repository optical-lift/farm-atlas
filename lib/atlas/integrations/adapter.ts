import type {
  ConnectedSourceDescriptor,
  IntegrationDomainPromotionResult,
  IntegrationEvidenceDraft,
  IntegrationSecretHandle,
  IntegrationSourceEnvelope,
  IntegrationSyncCheckpoint,
  IntegrationSyncHealth,
} from "./contract";

export interface IntegrationConnectRequest {
  custody: ConnectedSourceDescriptor["custody"];
  redirectUri?: string;
  requestedScopes?: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
}

export interface IntegrationConnectStart {
  mode: "redirect" | "instructions" | "already_connected";
  authorizationUrl?: string;
  stateKey?: string;
  instructions?: string;
}

export interface IntegrationConnectionReceipt {
  source: ConnectedSourceDescriptor;
  secretHandles: readonly IntegrationSecretHandle[];
}

export interface IntegrationPullRequest {
  source: ConnectedSourceDescriptor;
  checkpoint?: IntegrationSyncCheckpoint | null;
  from?: string | null;
  through?: string | null;
}

export interface IntegrationPullPage<TPayload = unknown> {
  envelopes: readonly IntegrationSourceEnvelope<TPayload>[];
  nextCheckpoint?: IntegrationSyncCheckpoint | null;
  complete: boolean;
}

export interface IntegrationWebhookRequest {
  headers: Readonly<Record<string, string | undefined>>;
  rawBody: Uint8Array;
  receivedAt: string;
}

export interface IntegrationWebhookReceipt<TPayload = unknown> {
  accepted: boolean;
  wakeSync: boolean;
  envelopes: readonly IntegrationSourceEnvelope<TPayload>[];
  responseStatus: number;
  responseBody?: string;
}

/**
 * Provider-specific transport boundary.
 *
 * Implementations know the provider protocol but do not know React, Next.js,
 * Vercel, farm dashboards, the Principal Clock, or downstream UI projections.
 */
export interface IntegrationProviderAdapter<TPayload = unknown> {
  readonly providerKey: string;

  startConnection?(request: IntegrationConnectRequest): Promise<IntegrationConnectStart>;

  completeConnection?(input: Readonly<Record<string, string>>): Promise<IntegrationConnectionReceipt>;

  pull?(request: IntegrationPullRequest): Promise<IntegrationPullPage<TPayload>>;

  receiveWebhook?(request: IntegrationWebhookRequest): Promise<IntegrationWebhookReceipt<TPayload>>;

  health(source: ConnectedSourceDescriptor): Promise<IntegrationSyncHealth>;
}

/** Converts one source envelope into source-attributed evidence drafts only. */
export interface IntegrationEvidenceAdapter<TPayload = unknown> {
  readonly domain: string;
  toEvidence(envelope: IntegrationSourceEnvelope<TPayload>): Promise<readonly IntegrationEvidenceDraft[]>;
}

/**
 * Explicit canonical-promotion boundary.
 *
 * This interface does not admit evidence. The integration pipeline owns custody
 * ordering and may invoke promote() only after first-time evidence admission.
 * Every returned write must name the domain authorityBoundary that permitted it.
 */
export interface IntegrationDomainAdapter<TPayload = unknown> {
  readonly domain: string;
  promote(
    envelope: IntegrationSourceEnvelope<TPayload>,
    evidence: readonly IntegrationEvidenceDraft[],
    admittedEvidenceIds: readonly string[],
  ): Promise<IntegrationDomainPromotionResult>;
}

export interface IntegrationRuntime<TPayload = unknown> {
  provider: IntegrationProviderAdapter<TPayload>;
  evidenceAdapters: readonly IntegrationEvidenceAdapter<TPayload>[];
  domainAdapters: readonly IntegrationDomainAdapter<TPayload>[];
}
