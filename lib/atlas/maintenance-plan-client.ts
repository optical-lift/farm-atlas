export type AtlasUnifiedMaintenanceItem = {
  schedule_date: string;
  maintenance_type: string;
  collection_label: string;
  collection_path: string;
  window_key: string;
  window_minutes: number;
  window_used_minutes: number;
  window_remaining_minutes: number;
  sequence_in_window: number;
  maintenance_object_id: string;
  object_id: string;
  object_key: string;
  object_label: string;
  zone_key: string | null;
  zone_label: string | null;
  condition: string;
  estimated_minutes: number;
  effective_priority_score: number;
  next_eligible_date: string;
  owner_priority: number;
  must_precede_task: boolean;
  guest_facing: boolean;
  crop_protective: boolean;
  revenue_linked: boolean;
  significant_day_work: boolean;
  dependent_task_ids: string[];
  dependent_task_labels: string[];
  priority_reasons: string[];
  weather_restrictions: Record<string, unknown>;
  equipment_requirements: string[];
  condition_triggered: boolean;
  route_based: boolean;
};

export type AtlasUnifiedMaintenanceResponse = {
  ok: boolean;
  farmKey: string;
  date: string;
  days: number;
  items: AtlasUnifiedMaintenanceItem[];
  error?: string;
  details?: string;
};

export async function fetchAtlasUnifiedMaintenancePlan(date: string, days = 1): Promise<AtlasUnifiedMaintenanceResponse> {
  const params = new URLSearchParams({ date, days: String(days) });
  const response = await fetch(`/api/atlas/maintenance-plan?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = (await response.json()) as AtlasUnifiedMaintenanceResponse;
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Maintenance plan failed.");
  return data;
}
