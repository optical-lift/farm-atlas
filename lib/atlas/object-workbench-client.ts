export type AtlasObjectEventType =
  | "observed"
  | "checked"
  | "weeded"
  | "watered"
  | "sowed"
  | "planted"
  | "germinated"
  | "pinched"
  | "bloom_started"
  | "harvested"
  | "maintained"
  | "cleared"
  | "blocked";

export type AtlasObjectWorkbenchObject = {
  farm_id: string;
  farm_key: string;
  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;
  object_id: string;
  object_key: string;
  object_label: string;
  object_type: string;
  object_mode: string | null;
  length_ft: number | string | null;
  width_ft: number | string | null;
  area_sqft: number | string | null;
  guest_visible: boolean | null;
  object_metadata: Record<string, unknown> | null;
  life_status: string | null;
  weed_pressure: string | null;
  water_status: string | null;
  last_touched_at: string | null;
  last_weeded_at: string | null;
  last_watered_at: string | null;
  last_checked_at: string | null;
  decision_required: boolean | null;
  harvest_confidence: string | null;
  presentability: string | null;
  active_crop_cycle_count: number;
  current_plant_instance_count: number;
  latest_event_id: string | null;
  latest_event_type: AtlasObjectEventType | null;
  latest_event_date: string | null;
  latest_event_note: string | null;
};

export type AtlasObjectCropCycle = {
  id: string;
  crop_cycle_key: string;
  crop_label: string;
  variety: string | null;
  cycle_state: string;
  lifecycle_status: string;
  sown_date: string | null;
  planted_date: string | null;
  germination_checked_date: string | null;
  harvest_started_date: string | null;
  last_harvest_date: string | null;
  expected_germination_start: string | null;
  expected_germination_end: string | null;
  expected_harvest_watch_start: string | null;
  expected_harvest_watch_end: string | null;
  expected_clear_date: string | null;
  note: string | null;
};

export type AtlasPlantLineage = {
  id: string;
  stable_key: string;
  lineage_name: string;
  common_name: string | null;
  botanical_name: string | null;
  source_name: string | null;
  source_type: string | null;
  origin_year: number | null;
  origin_detail: string | null;
  propagation_goal: string | null;
};

export type AtlasObjectPlantInstance = {
  id: string;
  lineage_id: string;
  stable_key: string;
  label: string;
  quantity: number | string | null;
  unit: string | null;
  generation: number | null;
  status: string;
  acquired_date: string | null;
  planted_date: string | null;
  note: string | null;
  lineage: AtlasPlantLineage | null;
};

export type AtlasObjectTimelineEvent = {
  event_id: string;
  object_id: string;
  object_key: string;
  object_label: string;
  field_log_id: string | null;
  crop_cycle_id: string | null;
  plant_instance_id: string | null;
  entity_label: string | null;
  entity_kind: "object" | "crop_cycle" | "plant_instance";
  event_type: AtlasObjectEventType;
  event_date: string;
  note: string | null;
  quantity: number | string | null;
  unit: string | null;
  source: string | null;
  created_at: string;
};

export type AtlasObjectWorkbenchResponse = {
  ok: boolean;
  object?: AtlasObjectWorkbenchObject;
  cropCycles?: AtlasObjectCropCycle[];
  plantInstances?: AtlasObjectPlantInstance[];
  events?: AtlasObjectTimelineEvent[];
  error?: string;
  details?: string;
};

export type RecordAtlasObjectEventInput = {
  eventType: AtlasObjectEventType;
  eventDate: string;
  note?: string;
  quantity?: number;
  unit?: string;
  cropCycleId?: string;
  plantInstanceId?: string;
  idempotencyKey: string;
};

export type RecordAtlasObjectEventResult = {
  eventId: string;
  fieldLogId: string;
  objectId: string;
  objectKey: string;
  eventType: AtlasObjectEventType;
  eventDate: string;
  deduplicated: boolean;
};

export async function fetchAtlasObjectWorkbench(objectKey: string) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = (await response.json()) as AtlasObjectWorkbenchResponse;
  if (!response.ok || !data.ok || !data.object) {
    throw new Error(data.details || data.error || "Atlas could not load this object.");
  }
  return {
    object: data.object,
    cropCycles: data.cropCycles ?? [],
    plantInstances: data.plantInstances ?? [],
    events: data.events ?? [],
  };
}

export async function recordAtlasObjectEvent(objectKey: string, input: RecordAtlasObjectEventInput) {
  const response = await fetch(`/api/atlas/objects/${encodeURIComponent(objectKey)}/events`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlas-Intent": "object-event-v1",
    },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as {
    ok: boolean;
    result?: RecordAtlasObjectEventResult;
    error?: string;
    details?: string;
  };
  if (!response.ok || !data.ok || !data.result) {
    throw new Error(data.details || data.error || "Atlas could not save this object event.");
  }
  return data.result;
}
