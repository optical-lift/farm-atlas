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

export type AtlasSession = {
  userId: string;
  email: string | null;
  displayName: string;
  activeFarmId: string | null;
  activeOrganizationId: string | null;
  memberships: AtlasSessionMembership[];
  organizationMemberships: AtlasSessionOrganizationMembership[];
};

export type AtlasSessionTiming = {
  clientMs: number;
  authUserMs: number;
  profileMs: number;
  farmMembershipsMs: number;
  organizationMembershipsMs: number;
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

    const [profileRead, membershipRead, organizationMembershipRead] = await Promise.all([
      measured(() => supabase
        .from("user_profiles")
        .select("user_id, display_name, default_farm_id, active")
        .eq("user_id", user.id)
        .maybeSingle()),
      measured(() => supabase
        .from("farm_memberships")
        .select(
          "id, farm_id, role, worker_key, active, permissions, farm:farms(id, stable_key, name, status)",
        )
        .eq("user_id", user.id)
        .eq("active", true)),
      measured(() => supabase
        .from("organization_memberships")
        .select(
          "id, organization_id, role, active, permissions, organization:organizations(id, stable_key, name, status)",
        )
        .eq("user_id", user.id)
        .eq("active", true)),
    ]);
    if (timing) {
      timing.profileMs = profileRead.ms;
      timing.farmMembershipsMs = membershipRead.ms;
      timing.organizationMembershipsMs = organizationMembershipRead.ms;
    }

    const { data: profile, error: profileError } = profileRead.value;
    const { data: memberships, error: membershipError } = membershipRead.value;
    const { data: organizationMemberships, error: organizationMembershipError } = organizationMembershipRead.value;

    if (profileError) throw new Error("Atlas profile read failed.");
    if (membershipError) throw new Error("Atlas farm membership read failed.");
    if (organizationMembershipError) throw new Error("Atlas organization membership read failed.");
    if (profile?.active === false) return null;

    const membershipRows = (memberships ?? []) as unknown as AtlasMembershipRow[];
    const organizationMembershipRows = (
      organizationMemberships ?? []
    ) as unknown as AtlasOrganizationMembershipRow[];
    const normalizeStartedAt = nowMs();
    const session = normalizeAtlasSession({
      user,
      profile,
      memberships: membershipRows,
      organizationMemberships: organizationMembershipRows,
    }) as AtlasSession | null;
    if (timing) timing.normalizeMs = elapsedMs(normalizeStartedAt);

    if (!session) return null;

    return {
      user,
      profile: (profile ?? null) as AtlasProfileRow,
      membershipRows,
      organizationMembershipRows,
      session,
    };
  } finally {
    if (timing) timing.totalMs = elapsedMs(totalStartedAt);
  }
}

export async function getAtlasSession(timing?: AtlasSessionTiming): Promise<AtlasSession | null> {
  return (await getAtlasSessionContext(timing))?.session ?? null;
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
