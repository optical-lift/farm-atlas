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

export type AtlasTaskCaptureByObject = Record<
  string,
  {
    result?: string;
    capture_kind?: string;
    completed_at?: string;
    field_log_id?: string;
    capture?: Record<string, unknown>;
  }
>;

export type AtlasTaskCardMetadata = {
  capture_by_object?: AtlasTaskCaptureByObject;
  [key: string]: unknown;
};

export type AtlasTaskCard = {
  farm_key: string;
  task_id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  generated_from: string | null;
  generated_from_id: string | null;
  action_key: string | null;
  work_class: string | null;
  parent_task_id: string | null;
  task_series_key: string | null;
  engine_instance_key: string | null;
  created_at: string;
  updated_at: string;
  metadata: AtlasTaskCardMetadata | null;
  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;
  task_logs: AtlasTaskCardLog[];
  task_outcomes: AtlasTaskOutcomeEvent[];
  task_transitions: AtlasTaskTransitionEvent[];
  objects: AtlasTaskCardObject[];
  resource_requirements: AtlasTaskCardResourceRequirement[];
  action_templates: AtlasTaskCardTemplate[];
};

export type AtlasTaskCardsResponse = {
  ok: boolean;
  farmKey: string;
  taskCards: AtlasTaskCard[];
  error?: string;
  details?: string;
};

export type AtlasTaskCardScope = "farm" | "owner" | "marshall" | "children" | "all";

export type AtlasTaskCardFetchOptions = {
  taskId?: string;
  scope?: AtlasTaskCardScope;
};

function currentUrlScope(): AtlasTaskCardScope | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const scope = params.get("scope");
  if (scope === "owner" || scope === "marshall" || scope === "children" || scope === "all") return scope;
  if (window.location.pathname === "/owner") return "owner";
  if (window.location.pathname === "/marshall") return "marshall";
  if (window.location.pathname === "/children") return "children";
  return null;
}

function canonicalScopeRows(taskCards: AtlasTaskCard[], scope: AtlasTaskCardScope) {
  if (scope === "owner") return taskCards.filter((task) => taskMatchesAssignee(task, "owner"));
  if (scope === "marshall") return taskCards.filter((task) => taskMatchesAssignee(task, "marshall"));
  if (scope === "children") return taskCards.filter((task) => taskMatchesAssignee(task, "kids"));
  return taskCards;
}

function listReadPath(pathname: string) {
  return (
    pathname === "/day" ||
    pathname === "/overview/week" ||
    pathname === "/overview/month" ||
    pathname === "/owner" ||
    pathname === "/marshall" ||
    pathname === "/children"
  );
}

export async function fetchAtlasTaskCards(
  input?: string | AtlasTaskCardFetchOptions,
): Promise<AtlasTaskCardsResponse> {
  const params = new URLSearchParams();
  const options: AtlasTaskCardFetchOptions = typeof input === "string" ? { taskId: input } : input ?? {};
  const inferredScope = currentUrlScope();
  const scope = options.scope ?? inferredScope ?? "farm";
  const assignmentScope = scope === "owner" || scope === "marshall" || scope === "children";

  if (options.taskId) params.set("taskId", options.taskId);
  if (assignmentScope) params.set("scope", "all");
  else if (scope !== "farm") params.set("scope", scope);

  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const useHomeReadPath = pathname === "/" && !options.taskId && scope === "farm";
  const useListReadPath = listReadPath(pathname) && !options.taskId;

  if (useListReadPath) {
    params.delete("taskId");
    params.set("scope", scope);
  }

  const endpoint = useHomeReadPath
    ? "/api/atlas/home-task-cards"
    : useListReadPath
      ? `/api/atlas/task-list-cards?${params.toString()}`
      : `/api/atlas/task-cards${params.toString() ? `?${params.toString()}` : ""}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const data = (await response.json()) as AtlasTaskCardsResponse;
  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to load Atlas task cards.");
  }

  return {
    ...data,
    taskCards: canonicalScopeRows(data.taskCards ?? [], scope),
  };
}
