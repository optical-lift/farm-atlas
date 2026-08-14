import "server-only";

import {
  enrichWorkerDayPlanTiming,
  normalizeWorkerDayPlan,
} from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

type WorkerSelfTarget = { farmId: string; membershipId: string };

export async function readWorkerSelfDayPlanForTarget(dateIso: string, target: WorkerSelfTarget) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_self_day_plan_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_day: dateIso,
  });
  if (error) throw new Error(error.message);

  const normalized = normalizeWorkerDayPlan(data);
  const plan = await enrichWorkerDayPlanTiming({ ...normalized, suggestions: [] });
  return { ...plan, suggestions: [] };
}
