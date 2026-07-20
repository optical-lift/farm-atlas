import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasMemberDirectoryRow = {
  record_kind: "membership" | "invite";
  record_id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  role: "owner" | "manager" | "farm_hand";
  worker_key: string | null;
  active: boolean;
  status: string;
  created_at: string;
};

export type AtlasMemberDirectory = {
  farmId: string;
  farmName: string;
  memberships: AtlasMemberDirectoryRow[];
  inviteDrafts: AtlasMemberDirectoryRow[];
};

export async function getOwnerMemberDirectory(
  access: AtlasRoleAccess,
): Promise<AtlasMemberDirectory> {
  if (access.membership.role !== "owner") {
    throw new Error("Owner membership required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_list_farm_members_v1", {
    p_farm_id: access.membership.farmId,
  });

  if (error) throw new Error("Atlas membership directory read failed.");

  const rows = (data ?? []) as AtlasMemberDirectoryRow[];
  return {
    farmId: access.membership.farmId,
    farmName: access.membership.farmName ?? access.membership.farmKey ?? "Farm",
    memberships: rows.filter((row) => row.record_kind === "membership"),
    inviteDrafts: rows.filter((row) => row.record_kind === "invite"),
  };
}
