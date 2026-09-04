import type { IntegrationProviderAdapter } from "../adapter";
import type {
  ConnectedSourceDescriptor,
  IntegrationAuthorizationState,
  IntegrationSyncHealth,
} from "../contract";
import type { LegacyAppleMessagesEvent } from "./apple-messages";

export interface CommunicationSourceHealthRow {
  connectedSourceId: string;
  providerKey: string;
  providerAccountKey: string;
  authorizationState: string;
  lastSyncAt?: string | null;
  lastCustodiedEventAt?: string | null;
  eventCount?: number | string | bigint | null;
  conflictCount?: number | string | bigint | null;
}

export interface AppleMessagesHealthReader {
  read(source: ConnectedSourceDescriptor): Promise<CommunicationSourceHealthRow | null>;
}

const AUTHORIZATION_STATES = new Set<IntegrationAuthorizationState>([
  "pending",
  "connected",
  "reauthorization_required",
  "revoked",
  "error",
]);

export function mapAppleMessagesHealth(
  source: ConnectedSourceDescriptor,
  row: CommunicationSourceHealthRow,
): IntegrationSyncHealth {
  if (source.providerKey !== "apple_messages") {
    throw new Error("Apple Messages health mapper requires an apple_messages source.");
  }
  if (row.connectedSourceId !== source.sourceId) {
    throw new Error("Communication source health row does not match the connected source.");
  }
  if (row.providerKey !== source.providerKey || row.providerAccountKey !== source.providerAccountKey) {
    throw new Error("Communication source health identity does not match the connected source.");
  }
  if (!AUTHORIZATION_STATES.has(row.authorizationState as IntegrationAuthorizationState)) {
    throw new Error("Communication source health returned an unsupported authorization state.");
  }

  const authorizationState = row.authorizationState as IntegrationAuthorizationState;
  return {
    connectedSourceId: source.sourceId,
    authorizationState,
    lastAttemptAt: row.lastSyncAt ?? null,
    lastSuccessAt: authorizationState === "connected" ? row.lastSyncAt ?? null : null,
    coverage: row.lastCustodiedEventAt
      ? { through: row.lastCustodiedEventAt, complete: false }
      : undefined,
    checkpoint: null,
    latestError: null,
  };
}

export function createAppleMessagesProviderAdapter(
  healthReader: AppleMessagesHealthReader,
): IntegrationProviderAdapter<LegacyAppleMessagesEvent> {
  return {
    providerKey: "apple_messages",
    async health(source) {
      const row = await healthReader.read(source);
      if (!row) {
        return {
          connectedSourceId: source.sourceId,
          authorizationState: source.authorizationState,
          lastAttemptAt: source.lastSyncAt ?? null,
          lastSuccessAt: null,
          checkpoint: null,
          latestError: {
            code: "source_health_unavailable",
            message: "Communication source health is unavailable for this connected source.",
            occurredAt: new Date().toISOString(),
            retryable: true,
          },
        };
      }
      return mapAppleMessagesHealth(source, row);
    },
  };
}
