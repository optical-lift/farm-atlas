export type AtlasObjectContent = {
  object_id: string;
  content_label: string;
  content_type: string;
  variety: string | null;
  planted_date: string | null;
  status: string;
  confidence: string;
  note: string | null;
};

export type AtlasRegistryObject = {
  id: string;
  zone_id: string | null;
  stable_key: string;
  label: string;
  object_type: string;
  object_mode: string | null;
  length_ft: number | null;
  width_ft: number | null;
  sort_order: number | null;
  contents: AtlasObjectContent[];
};

export type AtlasRegistryZone = {
  id: string;
  stable_key: string;
  label: string;
  zone_type: string | null;
  mode_bias: string | null;
  goal_text: string | null;
  sort_order: number | null;
  object_count: number;
  active_object_count: number;
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
