export type AtlasProjectStepCard = {
  step_id: string;
  step_order: number;
  step_title: string;
  step_status: string;
  step_note: string | null;
  task_id: string | null;
  task_title: string | null;
  task_type: string | null;
  task_status: string | null;
  task_priority: string | null;
  task_due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
};

export type AtlasProjectTaskCard = {
  task_id: string;
  task_title: string;
  task_type: string | null;
  task_status: string;
  task_priority: string | null;
  task_due_date: string | null;
  zone_key: string | null;
  zone_label: string | null;
  object_keys: string[];
  object_labels: string[];
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  link_role: string | null;
  sort_order: number | null;
};

export type AtlasProjectCard = {
  farm_key: string;

  project_id: string;
  project_key: string;
  project_title: string;
  project_status: string;
  project_goal_text: string | null;
  sort_order: number | null;
  project_metadata: Record<string, unknown> | null;

  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;

  project_goal_id: string | null;
  project_goal_key: string | null;
  goal_type: string | null;
  goal_label: string | null;
  target_window_label: string | null;
  target_start_date: string | null;
  target_due_date: string | null;
  planning_status: string | null;
  success_definition: string | null;
  goal_notes: string | null;
  goal_metadata: Record<string, unknown> | null;

  step_count: number | null;
  done_step_count: number | null;
  blocked_step_count: number | null;
  task_count: number | null;
  open_task_count: number | null;
  blocked_task_count: number | null;
  done_task_count: number | null;
  next_due_date: string | null;

  steps: AtlasProjectStepCard[];
  current_tasks: AtlasProjectTaskCard[];
};

export type AtlasProjectsResponse = {
  ok: boolean;
  farmKey: string;
  projects: AtlasProjectCard[];
  error?: string;
  details?: string;
};

export async function fetchAtlasProjects(): Promise<AtlasProjectsResponse> {
  const response = await fetch("/api/atlas/projects", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const data = (await response.json()) as AtlasProjectsResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to load Atlas projects.");
  }

  return data;
}
