import { buildWorkerResultMemory } from "@/lib/atlas/worker-results-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type WorkerResultMemory = {
  transitionId: string | null;
  taskId: string | null;
  taskTitle: string;
  taskType: string;
  transition: string;
  note: string | null;
  reason: string | null;
  occurredAt: string | null;
  zoneId: string | null;
  zoneKey: string | null;
  zoneLabel: string | null;
  actorMembershipId: string | null;
  actorDisplayName: string;
  actorWorkerKey: string | null;
};

type WorkerResultRow = {
  transition_id: string;
  task_id: string;
  task_title: string;
  task_type: string;
  transition: string;
  note: string | null;
  reason: string | null;
  occurred_at: string;
  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;
  actor_membership_id: string;
  actor_display_name: string;
  actor_worker_key: string | null;
};

export async function getWorkerRecentResults(
  access: AtlasRoleAccess,
  targetMembershipId: string | null = null,
  limit = 12,
): Promise<WorkerResultMemory[]> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_recent_results_v1", {
    p_farm_id: access.membership.farmId,
    p_target_membership_id: targetMembershipId,
    p_limit: limit,
  });

  if (error) throw new Error("Atlas worker result memory read failed.");
  return buildWorkerResultMemory((data ?? []) as WorkerResultRow[]) as WorkerResultMemory[];
}
