import "server-only";

import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type WorkerDayPlanWindow = "morning" | "afternoon" | "evening";
export type WorkerDayPlanSourceKind = "task" | "queue" | "rhythm" | "project_pull" | "floating_task";

export type WorkerDayPlanRow = {
  id: string;
  kind: "real" | "automatic" | "suggestion";
  sourceKind: WorkerDayPlanSourceKind;
  sourceId: string;
  taskId?: string | null;
  title: string;
  note?: string | null;
  status?: string | null;
  environment?: string | null;
  location?: string | null;
  expectedActiveMinutes: number;
  dayWindow: WorkerDayPlanWindow;
  workOrderNumber: number;
  automatic: boolean;
  requiresOwnerApproval: boolean;
  conditional?: boolean;
  fitsWithinCurrentRemaining?: boolean;
  recommended?: boolean;
  reason?: string | null;
};

export type WorkerDayPlan = {
  contractVersion: "owner_worker_day_plan_v1" | string;
  farmId: string;
  membershipId: string;
  serviceDate: string;
  availableWorkerDay: boolean;
  paidTargetMinutes: number;
  committedPaidMinutes: number;
  automaticPaidMinutes: number;
  remainingPaidMinutes: number;
  realWork: WorkerDayPlanRow[];
  automaticWork: WorkerDayPlanRow[];
  suggestions: WorkerDayPlanRow[];
  warnings: string[];
};

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function normalizeRows(value: unknown): WorkerDayPlanRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is WorkerDayPlanRow => Boolean(
    row
    && typeof row === "object"
    && typeof (row as WorkerDayPlanRow).id === "string"
    && typeof (row as WorkerDayPlanRow).title === "string",
  ));
}

function normalizePlan(value: unknown): WorkerDayPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Atlas returned an invalid worker day plan.");
  }
  const row = value as Record<string, unknown>;
  return {
    contractVersion: String(row.contractVersion || "owner_worker_day_plan_v1"),
    farmId: String(row.farmId || ""),
    membershipId: String(row.membershipId || ""),
    serviceDate: String(row.serviceDate || ""),
    availableWorkerDay: row.availableWorkerDay !== false,
    paidTargetMinutes: Math.max(0, Number(row.paidTargetMinutes) || 0),
    committedPaidMinutes: Math.max(0, Number(row.committedPaidMinutes) || 0),
    automaticPaidMinutes: Math.max(0, Number(row.automaticPaidMinutes) || 0),
    remainingPaidMinutes: Math.max(0, Number(row.remainingPaidMinutes) || 0),
    realWork: normalizeRows(row.realWork),
    automaticWork: normalizeRows(row.automaticWork),
    suggestions: normalizeRows(row.suggestions),
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
  };
}

export async function readOwnerWorkerDayPlan(dateIso: string) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD worker day is required.");

  const operatorContext = await readAtlasOwnerOperatorContext();
  const membershipId = effectiveOperatorMembershipId(operatorContext);
  const effective = operatorContext?.effective ?? null;
  if (!operatorContext?.isOperating || !membershipId || !effective?.farmId || effective.farmRole !== "farm_hand") {
    return {
      active: false as const,
      operatorLabel: effective?.displayName || "Anna",
      plan: null,
    };
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_worker_day_plan_api_v1", {
    p_farm_id: effective.farmId,
    p_membership_id: membershipId,
    p_day: dateIso,
  });
  if (error) throw new Error(error.message);

  return {
    active: true as const,
    operatorLabel: effective.displayName || "Anna",
    plan: normalizePlan(data),
  };
}
