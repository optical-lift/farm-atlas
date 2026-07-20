import { buildManagerDashboardProjection } from "@/lib/atlas/manager-dashboard-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { getAuthorizedFarm } from "@/lib/atlas-data/farms";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type ManagerAction = {
  id: string | null;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  taskType: string;
  visibilityScope: string;
  assignedMembershipId: string | null;
  blocker: string | null;
  detail: string | null;
};

export type ManagerDashboardProjection = {
  farm: {
    id: string | null;
    farmKey: string | null;
    name: string;
    status: string;
  };
  generatedForDate: string;
  counts: {
    open: number;
    blocked: number;
    overdue: number;
    today: number;
    workerQueue: number;
    unassignedWorker: number;
    managementQueue: number;
  };
  blocked: ManagerAction[];
  overdue: ManagerAction[];
  today: ManagerAction[];
  workerQueue: ManagerAction[];
  unassignedWorker: ManagerAction[];
  managementQueue: ManagerAction[];
};

type ManagerTaskRow = {
  id: string;
  farm_id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  visibility_scope: "management" | "assigned_worker" | "farm_shared";
  assigned_membership_id: string | null;
  parent_task_id: string | null;
};

function centralDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function getManagerTaskRows(farmId: string): Promise<ManagerTaskRow[]> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, farm_id, title, task_type, status, priority, due_date, unlock_text, blocker_text, note, metadata, visibility_scope, assigned_membership_id, parent_task_id",
    )
    .eq("farm_id", farmId)
    .in("visibility_scope", ["management", "assigned_worker", "farm_shared"])
    .in("status", ["open", "blocked"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(600);

  if (error) throw new Error("Atlas Manager task read failed.");
  return (data ?? []) as ManagerTaskRow[];
}

export async function getManagerDashboard(
  access: AtlasRoleAccess,
): Promise<ManagerDashboardProjection> {
  if (access.membership.role !== "owner" && access.membership.role !== "manager") {
    throw new Error("Manager or Owner membership required.");
  }

  const farmId = access.membership.farmId;
  const [farm, tasks] = await Promise.all([
    getAuthorizedFarm(farmId),
    getManagerTaskRows(farmId),
  ]);

  return buildManagerDashboardProjection({
    farm,
    tasks,
    todayIso: centralDateIso(),
  }) as ManagerDashboardProjection;
}
