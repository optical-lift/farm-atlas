export type AtlasTaskCardObject = {
  object_id: string;
  object_key: string;
  object_label: string;
  object_type: string;
  object_mode: string | null;
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
  created_at: string;
  updated_at: string;


  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;

task_logs: AtlasTaskCardLog[];

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

export async function fetchAtlasTaskCards(
  taskId?: string,
): Promise<AtlasTaskCardsResponse> {
  const params = new URLSearchParams();

  if (taskId) {
    params.set("taskId", taskId);
  }

  const response = await fetch(
    `/api/atlas/task-cards${params.toString() ? `?${params.toString()}` : ""}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  const data = (await response.json()) as AtlasTaskCardsResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to load Atlas task cards.");
  }

  return data;
}