import { isValidAtlasTaskId } from "@/lib/atlas/task-routing-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type OwnerTaskDetailRow = {
  id: string;
  farm_id: string;
  zone_id: string | null;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  completed_at: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
  parent_task_id: string | null;
  action_key: string | null;
  work_class: string | null;
};

export type OwnerTaskDetail = {
  task: OwnerTaskDetailRow;
  children: OwnerTaskDetailRow[];
};

const DETAIL_FIELDS =
  "id, farm_id, zone_id, title, task_type, status, priority, due_date, unlock_text, blocker_text, completed_at, note, metadata, updated_at, parent_task_id, action_key, work_class";

export async function getAuthorizedOwnerTaskById(
  taskId: string,
): Promise<OwnerTaskDetailRow | null> {
  if (!isValidAtlasTaskId(taskId)) return null;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(DETAIL_FIELDS)
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new Error("Atlas Owner task authorization read failed.");
  return (data as OwnerTaskDetailRow | null) ?? null;
}

export async function getOwnerTaskDetail(
  access: AtlasRoleAccess,
  taskId: string,
): Promise<OwnerTaskDetail | null> {
  if (access.membership.role !== "owner" || !isValidAtlasTaskId(taskId)) return null;

  const supabase = await createAtlasServerClient();
  const farmId = access.membership.farmId;

  const [taskResult, relationalChildrenResult, legacyChildrenResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(DETAIL_FIELDS)
      .eq("id", taskId)
      .eq("farm_id", farmId)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select(DETAIL_FIELDS)
      .eq("farm_id", farmId)
      .eq("parent_task_id", taskId)
      .neq("status", "archived")
      .order("created_at", { ascending: true }),
    supabase
      .from("tasks")
      .select(DETAIL_FIELDS)
      .eq("farm_id", farmId)
      .contains("metadata", { parent_task_id: taskId })
      .neq("status", "archived")
      .order("created_at", { ascending: true }),
  ]);

  if (taskResult.error) throw new Error("Atlas Owner task detail read failed.");
  if (relationalChildrenResult.error || legacyChildrenResult.error) {
    throw new Error("Atlas Owner checklist read failed.");
  }
  if (!taskResult.data) return null;

  const children = new Map<string, OwnerTaskDetailRow>();
  for (const row of [...(relationalChildrenResult.data ?? []), ...(legacyChildrenResult.data ?? [])]) {
    children.set(row.id as string, row as OwnerTaskDetailRow);
  }

  return {
    task: taskResult.data as OwnerTaskDetailRow,
    children: [...children.values()],
  };
}
