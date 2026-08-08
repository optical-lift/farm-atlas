import "server-only";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export type OwnerFinishProjectSummary = {
  projectId: string;
  projectTitle: string;
  released: Array<{ taskId: string; title: string; minutes: number; taskStatus: string | null }>;
  annaReadyCount: number;
  managementCount: number;
  blockedCount: number;
  completedCount: number;
  totalRemaining: number;
};

type ProjectRow = { id: string; title: string };
type PullItemRow = {
  id: string;
  title: string;
  status: string;
  preferred_membership_id: string | null;
  expected_active_minutes: number | null;
  active_task_id: string | null;
};
type MembershipRow = { id: string; role: string };
type TaskRow = { id: string; status: string | null };

export async function readOwnerFinishProjectSummary(): Promise<OwnerFinishProjectSummary | null> {
  const { data: projectData, error: projectError } = await atlasSupabase
    .schema("atlas")
    .from("projects")
    .select("id,title")
    .eq("project_key", "elm_finish_renovation_pool")
    .limit(1)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  const project = projectData as ProjectRow | null;
  if (!project) return null;

  const [{ data: itemData, error: itemError }, { data: membershipData, error: membershipError }] = await Promise.all([
    atlasSupabase.schema("atlas").from("project_pull_items")
      .select("id,title,status,preferred_membership_id,expected_active_minutes,active_task_id")
      .eq("project_id", project.id),
    atlasSupabase.schema("atlas").from("farm_memberships").select("id,role").eq("active", true),
  ]);
  if (itemError) throw new Error(itemError.message);
  if (membershipError) throw new Error(membershipError.message);

  const items = (itemData ?? []) as PullItemRow[];
  const roles = new Map(((membershipData ?? []) as MembershipRow[]).map((row) => [row.id, row.role]));
  const activeTaskIds = items.map((item) => item.active_task_id).filter((value): value is string => Boolean(value));
  const taskStatuses = new Map<string, string | null>();
  if (activeTaskIds.length) {
    const { data: tasks, error: taskError } = await atlasSupabase.schema("atlas").from("tasks").select("id,status").in("id", activeTaskIds);
    if (taskError) throw new Error(taskError.message);
    for (const task of (tasks ?? []) as TaskRow[]) taskStatuses.set(task.id, task.status);
  }

  const available = items.filter((item) => item.status === "available");
  const releasedItems = items.filter((item) => item.status === "selected" && item.active_task_id);
  const annaReadyCount = available.filter((item) => {
    const role = item.preferred_membership_id ? roles.get(item.preferred_membership_id) : "shared";
    return role === "farm_hand" || role === "shared";
  }).length;
  const managementCount = available.length - annaReadyCount;
  const blockedCount = items.filter((item) => item.status === "blocked").length;
  const completedCount = items.filter((item) => item.status === "completed").length;

  return {
    projectId: project.id,
    projectTitle: project.title,
    released: releasedItems.map((item) => ({
      taskId: item.active_task_id!,
      title: item.title,
      minutes: item.expected_active_minutes ?? 0,
      taskStatus: taskStatuses.get(item.active_task_id!) ?? null,
    })),
    annaReadyCount,
    managementCount,
    blockedCount,
    completedCount,
    totalRemaining: available.length + releasedItems.length + blockedCount,
  };
}
