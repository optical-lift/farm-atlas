import "server-only";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { WorkerDayPlan } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

export async function readWorkerDayOperationalTaskCards(plan: WorkerDayPlan) {
  const taskIds = Array.from(new Set(
    [...plan.realWork, ...plan.automaticWork]
      .map((row) => row.taskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  ));

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_day_operational_task_cards_v2", {
    p_farm_id: plan.farmId,
    p_membership_id: plan.membershipId,
    p_service_date: plan.serviceDate,
    p_task_ids: taskIds,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as AtlasTaskCard[] : [];
}
