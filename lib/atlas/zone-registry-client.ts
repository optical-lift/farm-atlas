export type AtlasRegistryMetadata = Record<string, unknown>;

export type AtlasObjectInspection = {
  crop_label: string;
  variety: string | null;
  stage: string;
  confidence: string;
  start_method: string | null;
  seeded_date: string | null;
  germinated_date: string | null;
  expected_germination_start: string | null;
  expected_germination_end: string | null;
  weeded_dates: string[];
  pinch_required: boolean | null;
  pinch_note: string | null;
  pinched_dates: string[];
  bloom_date: string | null;
  harvest_dates: string[];
  expected_harvest_watch_start: string | null;
  expected_harvest_watch_end: string | null;
  clear_bed_date: string | null;
  next_crop_planned: string | null;
  note: string | null;
  unknown_fields: string[];
};

export type AtlasObjectContent = {
  id: string;
  object_id: string;
  content_label: string;
  content_type: string;
  variety: string | null;
  planted_date: string | null;
  status: string;
  confidence: string;
  start_method: string | null;
  germinated_date: string | null;
  pinch_required: boolean | null;
  pinch_note: string | null;
  bloom_start_date: string | null;
  clear_bed_date: string | null;
  next_crop_planned: string | null;
  note: string | null;
  inspection: AtlasObjectInspection;
};

export type AtlasInspectionSummary = {
  crop_label: string;
  stage: string;
  unknown_count: number;
  seeded_date: string | null;
  variety: string | null;
};

export type AtlasRegistryObject = {
  id: string;
  zone_id: string | null;
  stable_key: string;
  label: string;
  object_type: string;
  object_mode: string | null;
  length_ft: number | string | null;
  width_ft: number | string | null;
  area_sqft: number | string | null;
  guest_visible: boolean | null;
  sort_order: number | null;
  metadata: AtlasRegistryMetadata | null;
  inspection_summary: AtlasInspectionSummary | null;
  contents: AtlasObjectContent[];
};

export type AtlasRegistryZone = {
  id: string;
  stable_key: string;
  label: string;
  zone_type: string | null;
  mode_bias: string | null;
  goal_text: string | null;
  current_state: string | null;
  sort_order: number | null;
  metadata: AtlasRegistryMetadata | null;
  object_count: number;
  active_object_count: number;
  unknown_count: number;
  objects: AtlasRegistryObject[];
};

export type AtlasZoneRegistryResponse = {
  ok: boolean;
  farmKey: string;
  zones: AtlasRegistryZone[];
  error?: string;
  details?: string;
};

export async function fetchAtlasZoneRegistry(): Promise<AtlasZoneRegistryResponse> {
  const response = await fetch("/api/atlas/zone-registry", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const data = (await response.json()) as AtlasZoneRegistryResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.details || data.error || "Failed to load Atlas zone registry.");
  }

  return data;
}
