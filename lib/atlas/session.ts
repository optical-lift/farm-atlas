import type { User } from "@supabase/supabase-js";

import { normalizeAtlasSession } from "@/lib/atlas/session-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasFarmRole = "owner" | "manager" | "farm_hand";

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

export type AtlasSession = {
  userId: string;
  email: string | null;
  displayName: string;
  activeFarmId: string | null;
  memberships: AtlasSessionMembership[];
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

export type AtlasSessionContext = {
  user: User;
  profile: AtlasProfileRow;
  membershipRows: AtlasMembershipRow[];
  session: AtlasSession;
};

export async function getAtlasSessionContext(): Promise<AtlasSessionContext | null> {
  const supabase = await createAtlasServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const [{ data: profile, error: profileError }, { data: memberships, error: membershipError }] =
    await Promise.all([
      supabase
        .from("user_profiles")
        .select("user_id, display_name, default_farm_id, active")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("farm_memberships")
        .select(
          "id, farm_id, role, worker_key, active, permissions, farm:farms(id, stable_key, name, status)",
        )
        .eq("user_id", user.id)
        .eq("active", true),
    ]);

  if (profileError) throw new Error("Atlas profile read failed.");
  if (membershipError) throw new Error("Atlas membership read failed.");
  if (profile?.active === false) return null;

  const membershipRows = (memberships ?? []) as unknown as AtlasMembershipRow[];
  const session = normalizeAtlasSession({ user, profile, memberships: membershipRows });

  if (!session) return null;

  return {
    user,
    profile: (profile ?? null) as AtlasProfileRow,
    membershipRows,
    session,
  };
}

export async function getAtlasSession(): Promise<AtlasSession | null> {
  return (await getAtlasSessionContext())?.session ?? null;
}

export function membershipForFarm(session: AtlasSession, farmId: string) {
  return session.memberships.find((membership) => membership.farmId === farmId) ?? null;
}

export function canSeeWholeFarm(role: AtlasFarmRole) {
  return role === "owner" || role === "manager";
}
