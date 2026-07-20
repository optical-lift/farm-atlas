import type { User } from "@supabase/supabase-js";

import {
  canSeeWholeFarm,
  getAtlasSessionContext,
  type AtlasFarmRole,
  type AtlasMembershipRow,
} from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type { AtlasFarmRole };

export type AtlasMembership = {
  id: string;
  farm_id: string;
  role: AtlasFarmRole;
  worker_key: string | null;
  active: boolean;
  permissions: Record<string, unknown>;
  farm: {
    id: string;
    stable_key: string;
    name: string;
    status: string;
  } | null;
};

export type AtlasIdentity = {
  user: User;
  profile: {
    user_id: string;
    display_name: string;
    default_farm_id: string | null;
    active: boolean;
  } | null;
  memberships: AtlasMembership[];
};

function farmForMembership(row: AtlasMembershipRow) {
  if (Array.isArray(row.farm)) return row.farm[0] ?? null;
  return row.farm;
}

export async function createAtlasAuthClient() {
  return createAtlasServerClient();
}

export async function clearAtlasSession() {
  const supabase = await createAtlasServerClient();
  await supabase.auth.signOut();
}

export async function getAtlasIdentity(): Promise<AtlasIdentity | null> {
  const context = await getAtlasSessionContext();
  if (!context) return null;

  return {
    user: context.user,
    profile: context.profile,
    memberships: context.membershipRows.map((membership) => ({
      id: membership.id,
      farm_id: membership.farm_id,
      role: membership.role,
      worker_key: membership.worker_key,
      active: membership.active,
      permissions: membership.permissions ?? {},
      farm: farmForMembership(membership),
    })),
  };
}

export function membershipForFarm(identity: AtlasIdentity, farmId: string) {
  return identity.memberships.find((membership) => membership.farm_id === farmId) ?? null;
}

export { canSeeWholeFarm };
