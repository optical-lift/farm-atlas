import "server-only";

import { normalizeWorkerDayOperationalTaskCards } from "@/lib/atlas/worker-day-operational-task-cards-server";
import {
  enrichWorkerDayPlanTiming,
  normalizeWorkerDayPlan,
} from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

type WorkerSelfTarget = { farmId: string; membershipId: string };

type WorkerSelfDayBundlePayload = {
  plan?: unknown;
  taskCards?: unknown;
};

async function normalizeWorkerSelfPlan(data: unknown, enrichTiming = true) {
  const normalized = normalizeWorkerDayPlan(data);
  if (!enrichTiming) return { ...normalized, suggestions: [] };
  const plan = await enrichWorkerDayPlanTiming({ ...normalized, suggestions: [] });
  return { ...plan, suggestions: [] };
}

export async function readWorkerSelfDayPlanForTarget(dateIso: string, target: WorkerSelfTarget) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_self_day_plan_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_day: dateIso,
  });
  if (error) throw new Error(error.message);
  return normalizeWorkerSelfPlan(data);
}

export async function readWorkerSelfDayBundleForTarget(dateIso: string, target: WorkerSelfTarget) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_self_day_bundle_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_day: dateIso,
  });
  if (error) throw new Error(error.message);

  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as WorkerSelfDayBundlePayload
    : {};
  // The worker sequence can derive safe mobility from each row's existing location.
  // Owner Day-editing timing enrichment belongs off the farm-hand first-paint path.
  const plan = await normalizeWorkerSelfPlan(payload.plan, false);
  const taskCards = normalizeWorkerDayOperationalTaskCards(payload.taskCards, { includeMoveContext: false });
  return { plan, taskCards };
}
