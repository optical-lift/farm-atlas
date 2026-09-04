import type {
  ConnectedSourceDescriptor,
  IntegrationEvidenceDraft,
  IntegrationIngestResult,
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

/**
 * Domain-specific promotion boundary.
 *
 * Provider capture is not allowed to mutate canonical domain state directly.
 * A domain adapter first emits source-attributed evidence. Any canonical write
 * must name the existing Atlas authority boundary that authorized it.
 */
export interface IntegrationDomainAdapter<TPayload = unknown> {
  readonly domain: string;

  toEvidence(envelope: IntegrationSourceEnvelope<TPayload>): Promise<readonly IntegrationEvidenceDraft[]>;

  ingest(
    envelope: IntegrationSourceEnvelope<TPayload>,
    evidence: readonly IntegrationEvidenceDraft[],
  ): Promise<IntegrationIngestResult>;
}

export interface IntegrationRuntime<TPayload = unknown> {
  provider: IntegrationProviderAdapter<TPayload>;
  domains: readonly IntegrationDomainAdapter<TPayload>[];
}
