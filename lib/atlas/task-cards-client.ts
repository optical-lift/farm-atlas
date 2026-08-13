import { atlasFarmDateIso, atlasFarmMonthEnd, atlasShiftFarmDate } from "@/lib/atlas/farm-day";
import { taskMatchesAssignee } from "@/lib/atlas/task-assignment";

export type AtlasTaskCardObject = {
  object_id: string;
  object_key: string;
  object_label: string;
  object_type: string;
  object_mode: string | null;
  life_status?: string | null;
  weed_pressure?: string | null;
  water_status?: string | null;
  last_touched_at?: string | null;
  last_weeded_at?: string | null;
  last_watered_at?: string | null;
  last_checked_at?: string | null;
  decision_required?: boolean | null;
  presentability?: string | null;
  state_metadata?: Record<string, unknown> | null;
};

export type AtlasTaskCardResourceRequirement = {
  requirement_id: string;
  requirement_role: string;
  move_role: string | null;
  requirement_source: string;
  quantity_needed: number | null;
  unit: string | null;
  status: string;
  note: string | null;
  resource_key: string | null;
  resource_label: string | null;
  resource_type: string | null;
  resource_category: string | null;
  resource_status: string | null;
  resource_quantity: number | null;
  resource_unit: string | null;
  condition_notes: string | null;
  restock_needed: boolean | null;
};

export type AtlasTaskCardTemplate = {
  template_id: string;
  template_key: string;
  template_label: string;
  action_type: string;
  required_resource_categories: string[];
  optional_resource_categories: string[];
  required_resource_keys: string[];
  optional_resource_keys: string[];
  creates_follow_up_task_types: string[];
  hard_parts: string[];
  unlocks: string[];
  card_language: string | null;
};

export type AtlasTaskCardLog = {
  field_log_id: string;
  log_date: string;
  action_types: string[];
  summary_sentence: string;
  note: string | null;
  created_at: string;
};

export type AtlasTaskOutcomeEvent = {
  event_id: string;
  outcome: "done" | "partial" | "blocked" | string;
  lane_key: string | null;
  work_key: string | null;
  blocker_reason: string | null;
  note: string | null;
  created_at: string;
};

export type AtlasTaskTransitionEvent = {
  transition_id: string;
  transition: string;
  previous_status: string | null;
  next_status: string | null;
  previous_due_date: string | null;
  target_date: string | null;
  action_key: string | null;
  work_class: string | null;
  note: string | null;
  reason: string | null;
  field_log_id: string | null;
  created_at: string;
};

export type AtlasTaskProjectPathNode = {
  projectId: string;
  projectKey: string;
  title: string;
  portfolioType: string;
};

export type AtlasTaskProjectContext = {
  projectId: string;
  projectKey: string;
  title: string;
  portfolioType: string;
  targetDate: string | null;
  linkRole: string;
  path: AtlasTaskProjectPathNode[];
};

export type AtlasTaskDependencyContext = {
  taskId: string;
  title: string;
  status: string;
  assigneeName: string;
  assigneeMembershipId?: string | null;
  requiredStatus: string;
  holdMode: string;
};

export type AtlasTaskMoveContext = {
  projects: AtlasTaskProjectContext[];
  unlocks: AtlasTaskDependencyContext[];
  waitingOn: AtlasTaskDependencyContext[];
};

export type AtlasTaskCard = {
  task_id: string;
  farm_id: string;
  farm_key?: string | null;
  organization_id?: string | null;
  organization_key?: string | null;
  task_scope?: "farm" | "organization" | "universal" | string | null;
  zone_id: string | null;
  title: string;
  task_type: string;
  action_key: string;
  work_class: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  completed_at: string | null;
  completed_by: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  zone_label: string | null;
  parent_task_id: string | null;
  task_series_key: string | null;
  engine_instance_key: string | null;
  visibility_scope: string;
  assigned_user_id?: string | null;
  assigned_membership_id?: string | null;
  planned_occurrence_id?: string | null;
  release_policy_id?: string | null;
  released_at?: string | null;
  release_reason?: string | null;
  operation_class?: string | null;
  operation_class_source?: string | null;
  objects?: AtlasTaskCardObject[];
  resource_requirements?: AtlasTaskCardResourceRequirement[];
  action_templates?: AtlasTaskCardTemplate[];
  task_logs?: AtlasTaskCardLog[];
  task_outcomes?: AtlasTaskOutcomeEvent[];
  task_transitions?: AtlasTaskTransitionEvent[];
  move_context?: AtlasTaskMoveContext | null;
};

export type AtlasTaskCardsResponse = {
  ok: boolean;
  taskCards: AtlasTaskCard[];
  farm?: { id: string; key: string; name: string } | null;
  farms?: { id: string; key: string; name: string }[];
  role?: string | null;
  scope?: "farm" | "organization" | "universal" | string | null;
  generatedAt?: string;
  error?: string;
  details?: string;
};

export type AtlasTaskCardFilters = {
  farmKey?: string;
  farmKeys?: string[];
  organizationKey?: string;
  scope?: "farm" | "organization" | "universal";
  includeOrganization?: boolean;
  status?: string;
  dueThrough?: string;
  doneDate?: string;
  exactDate?: string;
  taskId?: string;
  assignedUserId?: string;
  assignedMembershipId?: string;
  includeUnassigned?: boolean;
  viewerScoped?: boolean;
  limit?: number;
};

function buildTaskCardsQuery(filters: AtlasTaskCardFilters = {}) {
  const params = new URLSearchParams();
  if (filters.farmKey) params.set("farmKey", filters.farmKey);
  for (const farmKey of filters.farmKeys ?? []) params.append("farmKey", farmKey);
  if (filters.organizationKey) params.set("organizationKey", filters.organizationKey);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.includeOrganization === false) params.set("includeOrganization", "false");
  if (filters.status) params.set("status", filters.status);
  if (filters.dueThrough) params.set("dueThrough", filters.dueThrough);
  if (filters.doneDate) params.set("doneDate", filters.doneDate);
  if (filters.exactDate) params.set("exactDate", filters.exactDate);
  if (filters.taskId) params.set("taskId", filters.taskId);
  if (filters.assignedUserId) params.set("assignedUserId", filters.assignedUserId);
  if (filters.assignedMembershipId) params.set("assignedMembershipId", filters.assignedMembershipId);
  if (filters.includeUnassigned) params.set("includeUnassigned", "true");
  if (filters.viewerScoped) params.set("viewerScoped", "true");
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function fetchAtlasTaskCards(filters: AtlasTaskCardFilters = {}) {
  const response = await fetch(`/api/atlas/universal-task-cards${buildTaskCardsQuery(filters)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = (await response.json()) as AtlasTaskCardsResponse;
  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Atlas task cards failed to load.");
  }
  return data;
}

export function taskDueKey(task: AtlasTaskCard) {
  return task.due_date || "9999-12-31";
}

export function taskPriorityRank(priority: string) {
  const normalized = priority.trim().toLowerCase();
  if (normalized === "urgent") return 0;
  if (normalized === "high") return 1;
  if (normalized === "normal") return 2;
  if (normalized === "low") return 3;
  return 4;
}

export function sortAtlasTaskCards(tasks: AtlasTaskCard[]) {
  return [...tasks].sort((a, b) => {
    const byDue = taskDueKey(a).localeCompare(taskDueKey(b));
    if (byDue !== 0) return byDue;
    const byPriority = taskPriorityRank(a.priority) - taskPriorityRank(b.priority);
    if (byPriority !== 0) return byPriority;
    return a.title.localeCompare(b.title);
  });
}

export function todayTaskCards(tasks: AtlasTaskCard[]) {
  const today = atlasFarmDateIso();
  return sortAtlasTaskCards(tasks.filter((task) => task.status === "open" && task.due_date && task.due_date <= today));
}

export function overdueTaskCards(tasks: AtlasTaskCard[]) {
  const today = atlasFarmDateIso();
  return sortAtlasTaskCards(tasks.filter((task) => task.status === "open" && task.due_date && task.due_date < today));
}

export function upcomingTaskCards(tasks: AtlasTaskCard[], days = 7) {
  const today = atlasFarmDateIso();
  const end = atlasShiftFarmDate(today, days);
  return sortAtlasTaskCards(tasks.filter((task) => task.status === "open" && task.due_date && task.due_date > today && task.due_date <= end));
}

export function monthTaskCards(tasks: AtlasTaskCard[]) {
  const today = atlasFarmDateIso();
  const end = atlasFarmMonthEnd();
  return sortAtlasTaskCards(tasks.filter((task) => task.status === "open" && task.due_date && task.due_date >= today && task.due_date <= end));
}

export function assigneeTaskCards(tasks: AtlasTaskCard[], assigneeKey: string) {
  return tasks.filter((task) => taskMatchesAssignee(task, assigneeKey));
}
