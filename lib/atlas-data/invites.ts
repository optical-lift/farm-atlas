import { isValidInviteId } from "@/lib/atlas/invite-flow-core.js";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type PendingMembershipInvite = {
  invite_id: string;
  farm_id: string;
  farm_name: string;
  display_name: string;
  role: "manager" | "farm_hand";
  worker_key: string | null;
  status: "sent";
};

export async function getPendingMembershipInvite(
  inviteId: string,
): Promise<PendingMembershipInvite | null> {
  if (!isValidInviteId(inviteId)) return null;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc(
    "pending_membership_invite_for_current_user_v1",
    { p_invite_id: inviteId },
  );

  if (error) throw new Error("Atlas invitation read failed.");
  return (((data ?? []) as PendingMembershipInvite[])[0] ?? null);
}
