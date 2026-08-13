import "server-only";

import { readAtlasOwnerOperatorContext } from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { deriveAtlasTimingMobility, type AtlasTimingMobility } from "@/lib/atlas/timing-mobility";
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
  commitmentKind?: string | null;
  preferredWindowStart?: string | null;
  preferredWindowEnd?: string | null;
  safeWindowEnd?: string | null;
  timingWarning?: string | null;
  mobility?: AtlasTimingMobility;
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

export type OwnerWorkerDayPlanningTarget = {
  farmId: string;
  membershipId: string;
  displayName: string;
  source: "operator_lens" | "owner_direct";
};

type TimingTaskRow = {
  id: string;
  due_date: string | null;
  task_type: string | null;
  action_key: string | null;
  commitment_kind: string | null;
  metadata: Record<string, unknown> | null;
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
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Atlas returned an invalid worker day plan.");
  const row = value as Record<string, unknown>;
  return {
    contractVersion: String(row.contractVersion || "owner_worker_day_plan_v1"),
    farmId: String(row.farmId || ""), membershipId: String(row.membershipId || ""), serviceDate: String(row.serviceDate || ""),
    availableWorkerDay: row.availableWorkerDay !== false,
    paidTargetMinutes: Math.max(0, Number(row.paidTargetMinutes) || 0), committedPaidMinutes: Math.max(0, Number(row.committedPaidMinutes) || 0), automaticPaidMinutes: Math.max(0, Number(row.automaticPaidMinutes) || 0), remainingPaidMinutes: Math.max(0, Number(row.remainingPaidMinutes) || 0),
    realWork: normalizeRows(row.realWork), automaticWork: normalizeRows(row.automaticWork), suggestions: normalizeRows(row.suggestions),
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
  };
}

function labelFromWorkerKey(workerKey: string | null | undefined) { const value = workerKey?.trim(); return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Farm Hand"; }
function metadataDate(metadata: Record<string, unknown> | null, key: string) { const value = metadata?.[key]; return typeof value === "string" && validDateIso(value) ? value : null; }

function timingWindow(task: TimingTaskRow) {
  const metadata = task.metadata ?? {};
  const start = metadataDate(metadata, "window_start") ?? metadataDate(metadata, "projected_transplant_start") ?? metadataDate(metadata, "projected_germination_start");
  const preferredEnd = metadataDate(metadata, "window_end") ?? metadataDate(metadata, "projected_transplant_end") ?? metadataDate(metadata, "latest_safe_sow_date") ?? metadataDate(metadata, "projected_germination_end");
  const safeEnd = preferredEnd ?? (task.commitment_kind === "hard_date" ? task.due_date : null);
  const joined = `${task.task_type ?? ""} ${task.action_key ?? ""}`.toLowerCase();
  const warning = safeEnd ? /pot[_ -]?up/.test(joined) ? "Moving this may miss the preferred pot-up window." : task.commitment_kind === "hard_date" ? "Moving this crosses a committed farm date." : "Moving this may miss the preferred biological window." : null;
  return { start, preferredEnd, safeEnd, warning };
}

async function enrichPlanTiming(plan: WorkerDayPlan) {
  const taskIds = Array.from(new Set([...plan.realWork, ...plan.automaticWork, ...plan.suggestions].map((row) => row.taskId).filter((value): value is string => Boolean(value))));
  const fallback = (row: WorkerDayPlanRow): WorkerDayPlanRow => ({ ...row, mobility: deriveAtlasTimingMobility({ location: row.location, potential: row.kind === "suggestion" }) });
  if (!taskIds.length) return { ...plan, realWork: plan.realWork.map(fallback), automaticWork: plan.automaticWork.map(fallback), suggestions: plan.suggestions.map(fallback) };

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.from("tasks").select("id, due_date, task_type, action_key, commitment_kind, metadata").in("id", taskIds);
  if (error) throw new Error("Atlas could not load task timing truth for Day editing.");

  const timingByTask = new Map<string, ReturnType<typeof timingWindow> & { commitmentKind: string | null; mobility: AtlasTimingMobility }>();
  for (const task of (data ?? []) as TimingTaskRow[]) timingByTask.set(task.id, { ...timingWindow(task), commitmentKind: task.commitment_kind, mobility: deriveAtlasTimingMobility({ metadata: task.metadata, potential: false }) });

  const enrich = (row: WorkerDayPlanRow): WorkerDayPlanRow => {
    const timing = row.taskId ? timingByTask.get(row.taskId) : null;
    const baseMobility = timing?.mobility ?? deriveAtlasTimingMobility({ location: row.location, potential: false });
    const mobility: AtlasTimingMobility = { ...baseMobility, timingClass: row.kind === "suggestion" ? "potential" : baseMobility.constraintClass, travelLocation: baseMobility.travelLocation ?? row.location ?? null };
    if (!timing) return { ...row, mobility };
    return { ...row, commitmentKind: timing.commitmentKind, preferredWindowStart: timing.start, preferredWindowEnd: timing.preferredEnd, safeWindowEnd: timing.safeEnd, timingWarning: timing.warning, mobility };
  };

  return { ...plan, realWork: plan.realWork.map(enrich), automaticWork: plan.automaticWork.map(enrich), suggestions: plan.suggestions.map(enrich) };
}

export async function resolveOwnerWorkerDayPlanningTarget(): Promise<OwnerWorkerDayPlanningTarget | null> {
  const [operatorContext, session] = await Promise.all([readAtlasOwnerOperatorContext(), getAtlasSession()]);
  if (!session) return null;
  if (operatorContext?.isOperating && operatorContext.effective.farmRole === "farm_hand" && operatorContext.effective.farmId && operatorContext.effective.farmMembershipId) return { farmId: operatorContext.effective.farmId, membershipId: operatorContext.effective.farmMembershipId, displayName: operatorContext.effective.displayName || labelFromWorkerKey(operatorContext.effective.workerKey), source: "operator_lens" };
  const farmId = session.activeFarmId ?? operatorContext?.actor.farmId ?? session.memberships.find((membership) => membership.role === "owner")?.farmId ?? null;
  if (!farmId) return null;
  const ownerMembership = session.memberships.find((membership) => membership.farmId === farmId && membership.role === "owner");
  if (!ownerMembership) return null;
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.from("farm_memberships").select("id, worker_key").eq("farm_id", farmId).eq("role", "farm_hand").eq("active", true).order("created_at", { ascending: true });
  if (error) throw new Error("Atlas could not resolve the worker Day target.");
  const workers = (data ?? []) as Array<{ id: string; worker_key: string | null }>;
  if (workers.length !== 1) return null;
  const worker = workers[0];
  const option = operatorContext?.options.find((candidate) => candidate.farmMembershipId === worker.id) ?? null;
  return { farmId, membershipId: worker.id, displayName: option?.displayName || labelFromWorkerKey(worker.worker_key), source: "owner_direct" };
}

export async function readOwnerWorkerDayPlan(dateIso: string) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD worker day is required.");
  const target = await resolveOwnerWorkerDayPlanningTarget();
  if (!target) return { active: false as const, operatorLabel: "Farm Hand", target: null, plan: null };
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_worker_day_plan_choreographed_api_v1", { p_farm_id: target.farmId, p_membership_id: target.membershipId, p_day: dateIso });
  if (error) throw new Error(error.message);
  const plan = await enrichPlanTiming(normalizePlan(data));
  return { active: true as const, operatorLabel: target.displayName, target, plan };
}