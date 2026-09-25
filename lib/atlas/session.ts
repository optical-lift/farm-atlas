import type { User } from "@supabase/supabase-js";

import { normalizeAtlasSession } from "@/lib/atlas/session-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasFarmRole = "owner" | "manager" | "farm_hand";
export type AtlasOrganizationRole = "owner" | "consultant" | "member";

export type AtlasSessionMembership = {
  membershipId: string;
  farmId: string;
  farmKey: string | null;
  farmName: string | null;
  farmStatus: string | null;
  role: AtlasFarmRole;
  workerKey: string | null;
  permissions: Record<string, unknown>;
};

export type AtlasSessionOrganizationMembership = {
  membershipId: string;
  organizationId: string;
  organizationKey: string | null;
  organizationName: string | null;
  organizationStatus: string | null;
  role: AtlasOrganizationRole;
  permissions: Record<string, unknown>;
};

export type AtlasSessionResponsibility = {
  relationId: string;
  responsibilityKey: string;
  title: string | null;
  jurisdiction:
    | {
        kind: "entity";
        entityId: string;
        entityStableKey: string | null;
        entityKind: string | null;
        entityDisplayName: string | null;
      }
    | {
        kind: "domain";
        domain: string;
      };
  permittedOperations: string[];
  scope: Record<string, unknown>;
  beganAt: string | null;
};

export type AtlasSessionLedgerSeat = {
  seatId: string;
  seatState: string;
  beganAt: string | null;
  ledgerId: string;
  ledgerStableKey: string | null;
  ledgerName: string | null;
  ledgerState: string | null;
  subjectEntity: {
    id: string;
    stableKey: string | null;
    kind: string | null;
    displayName: string | null;
    identityState: string | null;
  } | null;
  legacyOperationalOrganizationId: string | null;
};

export type AtlasSession = {
  userId: string;
  email: string | null;
  displayName: string;
  realityState: string;
  personEntityId: string | null;
  personalAtlasId: string | null;
  activeLedgerId: string | null;
  ledgerSeats: AtlasSessionLedgerSeat[];
  responsibilities: AtlasSessionResponsibility[];
  compatibilityOrganizationIds: string[];
  activeFarmId: string | null;
  activeOrganizationId: string | null;
  memberships: AtlasSessionMembership[];
  /**
   * Legacy-only compatibility shape. Canonical session activation and Ledger
   * access never depend on this collection.
   */
  organizationMemberships: AtlasSessionOrganizationMembership[];
};

export type AtlasSessionTiming = {
  clientMs: number;
  authUserMs: number;
  profileMs: number;
  farmMembershipsMs: number;
  organizationMembershipsMs: number;
  sessionContextRpcMs?: number;
  normalizeMs: number;
  totalMs: number;
};

export type AtlasProfileRow = {
  user_id: string;
  display_name: string;
  default_farm_id: string | null;
  active: boolean;
} | null;

export type AtlasMembershipRow = {
  id: string;
  farm_id: string;
  role: AtlasFarmRole;
  worker_key: string | null;
  active: boolean;
  permissions: Record<string, unknown> | null;
  farm:
    | {
        id: string;
        stable_key: string;
        name: string;
        status: string;
      }
    | Array<{
        id: string;
        stable_key: string;
        name: string;
        status: string;
      }>
    | null;
};

export type AtlasOrganizationMembershipRow = {
  id: string;
  organization_id: string;
  role: AtlasOrganizationRole;
  active: boolean;
  permissions: Record<string, unknown> | null;
  organization:
    | {
        id: string;
        stable_key: string;
        name: string;
        status: string;
      }
    | Array<{
        id: string;
        stable_key: string;
        name: string;
        status: string;
      }>
    | null;
};

type AtlasRealityPersonPayload = {
  id?: string | null;
  stableKey?: string | null;
  kind?: string | null;
  displayName?: string | null;
  identityState?: string | null;
} | null;

type AtlasPersonalAtlasPayload = {
  id?: string | null;
  personEntityId?: string | null;
  state?: string | null;
  native?: boolean | null;
} | null;

type AtlasRealitySessionPayload = {
  state?: string | null;
  user?: {
    id?: string | null;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  } | null;
  person?: AtlasRealityPersonPayload;
  personalAtlas?: AtlasPersonalAtlasPayload;
  ledgerSeats?: unknown[] | null;
  responsibilities?: unknown[] | null;
  profile?: AtlasProfileRow;
  memberships?: AtlasMembershipRow[] | null;
  compatibilityOrganizationIds?: unknown[] | null;
};

export type AtlasSessionContext = {
  user: User;
  profile: AtlasProfileRow;
  membershipRows: AtlasMembershipRow[];
  organizationMembershipRows: AtlasOrganizationMembershipRow[];
  session: AtlasSession;
};

function nowMs() {
  return performance.now();
}

function elapsedMs(startedAt: number) {
  return Math.round((nowMs() - startedAt) * 10) / 10;
}

async function measured<T>(read: () => PromiseLike<T>) {
  const startedAt = nowMs();
  const value = await read();
  return { value, ms: elapsedMs(startedAt) };
}

function normalizeRealityPayload(
  payload: AtlasRealitySessionPayload,
  user: User | AtlasRealitySessionPayload["user"],
) {
  return normalizeAtlasSession({
    user,
    profile: payload.profile ?? null,
    memberships: payload.memberships ?? [],
    organizationMemberships: [],
    state: payload.state ?? null,
    person: payload.person ?? null,
    personalAtlas: payload.personalAtlas ?? null,
    ledgerSeats: payload.ledgerSeats ?? [],
    responsibilities: payload.responsibilities ?? [],
    compatibilityOrganizationIds: payload.compatibilityOrganizationIds ?? [],
  }) as AtlasSession | null;
}

export async function getAtlasSessionContext(timing?: AtlasSessionTiming): Promise<AtlasSessionContext | null> {
  const totalStartedAt = nowMs();
  try {
    const clientRead = await measured(() => createAtlasServerClient());
    if (timing) timing.clientMs = clientRead.ms;
    const supabase = clientRead.value;

    const userRead = await measured(() => supabase.auth.getUser());
    if (timing) timing.authUserMs = userRead.ms;
    const {
      data: { user },
      error: userError,
    } = userRead.value;

    if (userError || !user) return null;

    const contextRead = await measured(() => supabase.rpc("current_session_context_api_v2"));
    if (timing) {
      timing.sessionContextRpcMs = contextRead.ms;
      timing.profileMs = 0;
      timing.farmMembershipsMs = 0;
      timing.organizationMembershipsMs = 0;
    }
    const { data, error } = contextRead.value;
    if (error) throw new Error("Atlas Reality session context read failed.");
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;

    const payload = data as unknown as AtlasRealitySessionPayload;
    const normalizeStartedAt = nowMs();
    const session = normalizeRealityPayload(payload, user);
    if (timing) timing.normalizeMs = elapsedMs(normalizeStartedAt);
    if (!session) return null;

    return {
      user,
      profile: (payload.profile ?? null) as AtlasProfileRow,
      membershipRows: (payload.memberships ?? []) as AtlasMembershipRow[],
      organizationMembershipRows: [],
      session,
    };
  } finally {
    if (timing) timing.totalMs = elapsedMs(totalStartedAt);
  }
}

export async function getAtlasSessionFast(timing?: AtlasSessionTiming): Promise<AtlasSession | null> {
  const totalStartedAt = nowMs();
  try {
    const clientRead = await measured(() => createAtlasServerClient());
    if (timing) timing.clientMs = clientRead.ms;
    const supabase = clientRead.value;

    const contextRead = await measured(() => supabase.rpc("current_session_context_api_v2"));
    if (timing) {
      timing.sessionContextRpcMs = contextRead.ms;
      timing.authUserMs = 0;
      timing.profileMs = 0;
      timing.farmMembershipsMs = 0;
      timing.organizationMembershipsMs = 0;
    }
    const { data, error } = contextRead.value;
    if (error) throw new Error("Atlas Reality session context read failed.");
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;

    const payload = data as unknown as AtlasRealitySessionPayload;
    const normalizeStartedAt = nowMs();
    const session = normalizeRealityPayload(payload, payload.user ?? null);
    if (timing) timing.normalizeMs = elapsedMs(normalizeStartedAt);
    return session;
  } finally {
    if (timing) timing.totalMs = elapsedMs(totalStartedAt);
  }
}

export async function getAtlasSession(timing?: AtlasSessionTiming): Promise<AtlasSession | null> {
  return getAtlasSessionFast(timing);
}

export function atlasSessionHasResponsibility(
  session: AtlasSession,
  responsibilityKey: string,
  operationKey: string,
) {
  return session.responsibilities.some(
    (responsibility) =>
      responsibility.responsibilityKey === responsibilityKey
      && responsibility.permittedOperations.includes(operationKey),
  );
}

export function membershipForFarm(session: AtlasSession, farmId: string) {
  return session.memberships.find((membership) => membership.farmId === farmId) ?? null;
}

export function membershipForOrganization(session: AtlasSession, organizationId: string) {
  return session.organizationMemberships.find(
    (membership) => membership.organizationId === organizationId,
  ) ?? null;
}

export function canSeeWholeFarm(role: AtlasFarmRole) {
  return role === "owner" || role === "manager";
}
