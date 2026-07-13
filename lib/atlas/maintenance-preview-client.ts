export type AtlasMaintenancePreviewItem = {
  schedule_date: string;
  window_key: "morning" | "evening" | string;
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
  condition: "maintained" | "moderate" | "heavy" | "reset" | string;
  estimated_minutes: number;
  priority_score: number;
  next_eligible_date: string;
  must_precede_task: boolean;
  guest_facing: boolean;
  crop_protective: boolean;
  revenue_linked: boolean;
  significant_day_work: boolean;
  priority_reasons: string[];
};

export type AtlasMaintenancePreviewResponse = {
  ok: boolean;
  farmKey: string;
  maintenanceType: string;
  startDate: string;
  days: number;
  previewOnly: true;
  items: AtlasMaintenancePreviewItem[];
  error?: string;
  details?: string;
};

export async function fetchAtlasMaintenancePreview(
  startDate: string,
  days = 7,
  maintenanceType = "weed",
): Promise<AtlasMaintenancePreviewResponse> {
  const params = new URLSearchParams({
    startDate,
    days: String(days),
    maintenanceType,
  });

  const response = await fetch(`/api/atlas/maintenance-preview?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const data = (await response.json()) as AtlasMaintenancePreviewResponse;
  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to load maintenance preview.");
  }

  return data;
}
