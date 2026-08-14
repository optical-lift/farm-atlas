import "server-only";

import type { WorkerDayPlan, WorkerDayPlanRow } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

type WorkerSelfTarget = { farmId: string; membershipId: string };

function normalizeRows(value: unknown): WorkerDayPlanRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is WorkerDayPlanRow => Boolean(row && typeof row === "object" && typeof (row as WorkerDayPlanRow).id === "string" && typeof (row as WorkerDayPlanRow).title === "string"));
}

function normalizePlan(value: unknown): WorkerDayPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Atlas returned an invalid Farm Hand Worker Day plan.");
  const row = value as Record<string, unknown>;
  return {
    contractVersion: String(row.contractVersion || "worker_self_day_plan_v1"),
    farmId: String(row.farmId || ""), membershipId: String(row.membershipId || ""), serviceDate: String(row.serviceDate || ""),
    availableWorkerDay: row.availableWorkerDay !== false,
    paidTargetMinutes: Math.max(0, Number(row.paidTargetMinutes) || 0), committedPaidMinutes: Math.max(0, Number(row.committedPaidMinutes) || 0), automaticPaidMinutes: Math.max(0, Number(row.automaticPaidMinutes) || 0), remainingPaidMinutes: Math.max(0, Number(row.remainingPaidMinutes) || 0),
    realWork: normalizeRows(row.realWork), automaticWork: normalizeRows(row.automaticWork), suggestions: [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
  };
}

export async function readWorkerSelfDayPlanForTarget(dateIso: string, target: WorkerSelfTarget) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_self_day_plan_api_v1", { p_farm_id: target.farmId, p_membership_id: target.membershipId, p_day: dateIso });
  if (error) throw new Error(error.message);
  return normalizePlan(data);
}
