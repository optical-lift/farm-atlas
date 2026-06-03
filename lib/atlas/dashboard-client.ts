export type AtlasDashboardZone = {
  farm_key: string;
  zone_id: string;
  zone_key: string;
  zone_label: string;
  zone_type: string | null;
  mode_bias: string | null;
  goal_text: string | null;
  current_state: string | null;
  weed_pressure: string | null;
  water_status: string | null;
  visible_to_guests: boolean | null;
  sort_order: number | null;
  object_count: number | null;
  active_content_count: number | null;
  open_task_count: number | null;
  blocked_task_count: number | null;
  last_log_date: string | null;
};

export type AtlasDashboardResponse = {
  ok: boolean;
  farmKey: string;
  zones: AtlasDashboardZone[];
  error?: string;
  details?: string;
};

export async function fetchAtlasDashboard(): Promise<AtlasDashboardResponse> {
  const response = await fetch("/api/atlas/dashboard", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const data = (await response.json()) as AtlasDashboardResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to load Atlas dashboard.");
  }

  return data;
}