import { buildWorkerHandProjection } from "@/lib/atlas/worker-hand-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type WorkerHandTask = {
  taskId: string | null;
  title: string;
  taskType: string;
  status: string;
  priority: string;
  dueDate: string | null;
  instruction: string | null;
  blocker: string | null;
  zoneId: string | null;
  zoneKey: string | null;
  zoneLabel: string | null;
  assignedMembershipId: string | null;
  visibilityScope: string;
  lane: "blocked" | "overdue" | "today" | "undated";
  totalSteps: number;
  completedSteps: number;
  canAct: boolean;
  metadata: Record<string, unknown>;
  workClass: string | null;
  actionKey: string | null;
  commitmentKind: string | null;
  effortUnits: number;
  taskScope: string | null;
};

export type WorkerHandProjection = {
  farm: { id: string | null; name: string };
  forDate: string;
  viewerRole: string | null;
  worker: { membershipId: string; displayName: string; workerKey: string | null } | null;
  canAct: boolean;
  unassignedWorkerTaskCount: number;
  counts: { total: number; blocked: number; overdue: number; today: number; undated: number };
  lanes: {
    blocked: WorkerHandTask[];
    overdue: WorkerHandTask[];
    today: WorkerHandTask[];
    undated: WorkerHandTask[];
  };
};

type WorkerHandContextRow = {
  farm_id: string;
  farm_name: string;
  viewer_role: string;
  worker_membership_id: string | null;
  worker_display_name: string | null;
  worker_key: string | null;
  can_act: boolean;
  unassigned_worker_task_count: number | string;
};

type WorkerHandTaskRow = {
  task_id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  instruction: string | null;
  blocker_text: string | null;
  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;
  assigned_membership_id: string | null;
  visibility_scope: string;
  task_lane: "blocked" | "overdue" | "today" | "undated";
  total_steps: number | string;
  completed_steps: number | string;
  can_act: boolean;
  metadata?: Record<string, unknown> | null;
  work_class?: string | null;
  action_key?: string | null;
  commitment_kind?: string | null;
  effort_units?: number | string | null;
  task_scope?: string | null;
};

function centralDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function getWorkerHand(
  access: AtlasRoleAccess,
  targetMembershipId: string | null = null,
  requestedDate: string | null = null,
): Promise<WorkerHandProjection> {
  const supabase = await createAtlasServerClient();
  const forDate = requestedDate ?? centralDateIso();
  const farmId = access.membership.farmId;
  const args = { p_farm_id: farmId, p_for_date: forDate, p_target_membership_id: targetMembershipId };

  const contextResult = await supabase.rpc("worker_hand_context_v1", {
    p_farm_id: farmId,
    p_target_membership_id: targetMembershipId,
  });
  if (contextResult.error) throw new Error("Atlas worker context read failed.");

  let tasksResult = await supabase.rpc("worker_task_hand_v2", args);
  if (tasksResult.error) tasksResult = await supabase.rpc("worker_task_hand_v1", args);
  if (tasksResult.error) throw new Error("Atlas worker hand read failed.");

  const context = ((contextResult.data ?? []) as WorkerHandContextRow[])[0] ?? null;
  return buildWorkerHandProjection({ context, tasks: (tasksResult.data ?? []) as WorkerHandTaskRow[], forDate }) as WorkerHandProjection;
}
