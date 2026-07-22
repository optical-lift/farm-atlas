const FINAL_ZONE_KEYS = [
  "field_rows",
  "berry_walk_flower_rows",
  "barn_beds",
  "main_garden",
  "entry_billboard",
  "follow_me",
  "curve_garden",
  "u_pick",
  "original_berry_walk",
  "asparagus_row",
  "grow_room",
  "lilac_haven",
  "redbud_islands",
  "memorial_garden",
  "chicken_coop",
];

type JsonRecord = Record<string, unknown>;

type ZoneRow = {
  id: string;
  stable_key: string;
  label: string;
  zone_type: string | null;
  mode_bias: string | null;
  goal_text: string | null;
  current_state: string | null;
  sort_order: number | null;
  metadata?: JsonRecord | null;
};

type ObjectRow = {
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
  metadata?: JsonRecord | null;
};

type ContentRow = {
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
  expected_germination_start: string | null;
  expected_germination_end: string | null;
  expected_harvest_watch_start: string | null;
  expected_harvest_watch_end: string | null;
  expected_clear_date: string | null;
  note: string | null;
};

type CropCycleRow = {
  crop_cycle_id: string;
  object_id: string | null;
  crop_label: string;
  variety: string | null;
  cycle_state: string;
  lifecycle_status: string;
  sown_date: string | null;
  planted_date: string | null;
  germination_checked_date: string | null;
  expected_germination_start: string | null;
  expected_germination_end: string | null;
  harvest_started_date: string | null;
  last_harvest_date: string | null;
  cleared_date: string | null;
  expected_harvest_watch_start: string | null;
  expected_harvest_watch_end: string | null;
  expected_clear_date: string | null;
  crop_profile_stable_key: string | null;
  default_planting_method: string | null;
  note: string | null;
};

type EventRow = {
  id: string;
  object_id: string;
  object_content_id: string | null;
  event_type: string;
  event_date: string;
  note: string | null;
  metadata?: JsonRecord | null;
};

export type ZoneRegistrySource = {
  zones?: ZoneRow[] | null;
  objects?: ObjectRow[] | null;
  contents?: ContentRow[] | null;
  cropCycles?: CropCycleRow[] | null;
  events?: EventRow[] | null;
};

function isRegistryHidden(row: { current_state?: string | null; metadata?: JsonRecord | null }) {
  return row.current_state === "archived" || row.metadata?.registry_hidden === true;
}

function datesFor(events: EventRow[], eventType: string) {
  return Array.from(
    new Set(
      events
        .filter((event) => event.event_type === eventType)
        .map((event) => event.event_date)
        .filter(Boolean),
    ),
  ).sort();
}

function firstDate(...dates: Array<string | null | undefined>) {
  return dates.find(Boolean) ?? null;
}

function unknownFieldsFor(content: ContentRow, scopedEvents: EventRow[]) {
  const unknowns: string[] = [];

  if (!content.planted_date) unknowns.push("Seeded");
  if (!content.variety) unknowns.push("Variety");
  if (!content.germinated_date && ["germination_check", "germinating", "growing"].includes(content.status)) {
    unknowns.push("Germinated");
  }
  if (datesFor(scopedEvents, "weeded").length === 0) unknowns.push("Weeded");
  if (content.pinch_required === null) unknowns.push("Pinch");
  if (!content.bloom_start_date && datesFor(scopedEvents, "bloom_started").length === 0) unknowns.push("Bloom");
  if (datesFor(scopedEvents, "harvested").length === 0) unknowns.push("Harvest");
  if (!content.clear_bed_date && !content.expected_clear_date && datesFor(scopedEvents, "cleared").length === 0) {
    unknowns.push("Clear bed");
  }
  if (!content.next_crop_planned) unknowns.push("Next crop");

  return unknowns;
}

function inspectionFor(content: ContentRow, objectEvents: EventRow[]) {
  const scopedEvents = objectEvents.filter(
    (event) => !event.object_content_id || event.object_content_id === content.id || event.metadata?.crop_cycle_id === content.id,
  );

  const bloomDates = datesFor(scopedEvents, "bloom_started");
  const clearDates = datesFor(scopedEvents, "cleared");
  const pinchedDates = datesFor(scopedEvents, "pinched");

  return {
    crop_label: content.content_label,
    variety: content.variety,
    stage: content.status,
    confidence: content.confidence,
    start_method: content.start_method,
    seeded_date: content.planted_date,
    germinated_date: content.germinated_date,
    expected_germination_start: content.expected_germination_start,
    expected_germination_end: content.expected_germination_end,
    weeded_dates: datesFor(scopedEvents, "weeded"),
    pinch_required: content.pinch_required,
    pinch_note: content.pinch_note,
    pinched_dates: pinchedDates,
    bloom_date: firstDate(content.bloom_start_date, bloomDates[0]),
    harvest_dates: datesFor(scopedEvents, "harvested"),
    expected_harvest_watch_start: content.expected_harvest_watch_start,
    expected_harvest_watch_end: content.expected_harvest_watch_end,
    clear_bed_date: firstDate(content.clear_bed_date, content.expected_clear_date, clearDates[0]),
    next_crop_planned: content.next_crop_planned,
    note: content.note,
    unknown_fields: unknownFieldsFor(content, scopedEvents),
  };
}

function cropCycleContent(cycle: CropCycleRow): ContentRow | null {
  if (!cycle.object_id) return null;

  return {
    id: cycle.crop_cycle_id,
    object_id: cycle.object_id,
    content_label: cycle.crop_label,
    content_type: "crop_cycle",
    variety: cycle.variety,
    planted_date: cycle.sown_date ?? cycle.planted_date,
    status: cycle.cycle_state,
    confidence: "high",
    start_method: cycle.default_planting_method,
    germinated_date: cycle.germination_checked_date,
    pinch_required: false,
    pinch_note: cycle.crop_profile_stable_key?.includes("sunflower")
      ? "Sunflower crop cycle; do not pinch single-stem production unless a specific variety note says otherwise."
      : null,
    bloom_start_date: cycle.harvest_started_date,
    clear_bed_date: cycle.cleared_date,
    next_crop_planned: null,
    expected_germination_start: cycle.expected_germination_start,
    expected_germination_end: cycle.expected_germination_end,
    expected_harvest_watch_start: cycle.expected_harvest_watch_start,
    expected_harvest_watch_end: cycle.expected_harvest_watch_end,
    expected_clear_date: cycle.expected_clear_date,
    note: cycle.note,
  };
}

export function buildZoneRegistry(source: ZoneRegistrySource) {
  const zones = Array.isArray(source.zones) ? source.zones : [];
  const objects = Array.isArray(source.objects) ? source.objects : [];
  const contents = Array.isArray(source.contents) ? source.contents : [];
  const cropCycles = Array.isArray(source.cropCycles) ? source.cropCycles : [];
  const events = Array.isArray(source.events) ? source.events : [];

  const finalZoneKeySet = new Set(FINAL_ZONE_KEYS);
  const visibleZones = zones.filter((zone) => finalZoneKeySet.has(zone.stable_key) && !isRegistryHidden(zone));
  const visibleZoneIds = new Set(visibleZones.map((zone) => zone.id));
  const visibleObjects = objects.filter((object) => {
    if (!object.zone_id || !visibleZoneIds.has(object.zone_id)) return false;
    return object.metadata?.registry_hidden !== true;
  });

  const visibleObjectIds = new Set(visibleObjects.map((object) => object.id));
  const eventsByObject = new Map<string, EventRow[]>();
  events
    .filter((event) => visibleObjectIds.has(event.object_id))
    .forEach((event) => {
      const list = eventsByObject.get(event.object_id) ?? [];
      list.push(event);
      eventsByObject.set(event.object_id, list);
    });

  const contentByObject = new Map<string, Array<ContentRow & { inspection: ReturnType<typeof inspectionFor> }>>();
  const mergedContents: ContentRow[] = [
    ...cropCycles.map(cropCycleContent).filter((content): content is ContentRow => Boolean(content)),
    ...contents,
  ].filter((content) => visibleObjectIds.has(content.object_id));

  mergedContents.forEach((content) => {
    const objectEvents = eventsByObject.get(content.object_id) ?? [];
    const list = contentByObject.get(content.object_id) ?? [];
    list.push({ ...content, inspection: inspectionFor(content, objectEvents) });
    contentByObject.set(content.object_id, list);
  });

  const objectsByZone = new Map<string, ObjectRow[]>();
  visibleObjects.forEach((object) => {
    if (!object.zone_id) return;
    const list = objectsByZone.get(object.zone_id) ?? [];
    list.push(object);
    objectsByZone.set(object.zone_id, list);
  });

  const registry = visibleZones.map((zone) => {
    const zoneObjects = objectsByZone.get(zone.id) ?? [];
    const objectsWithContents = zoneObjects.map((object) => {
      const contentsForObject = contentByObject.get(object.id) ?? [];
      const primaryInspection = contentsForObject[0]?.inspection ?? null;

      return {
        ...object,
        contents: contentsForObject,
        inspection_summary: primaryInspection
          ? {
              crop_label: primaryInspection.crop_label,
              stage: primaryInspection.stage,
              unknown_count: primaryInspection.unknown_fields.length,
              seeded_date: primaryInspection.seeded_date,
              variety: primaryInspection.variety,
            }
          : null,
      };
    });

    const activeObjectCount = objectsWithContents.filter((object) => object.contents.length > 0).length;
    const unknownCount = objectsWithContents.reduce(
      (sum, object) => sum + object.contents.reduce(
        (contentSum, content) => contentSum + content.inspection.unknown_fields.length,
        0,
      ),
      0,
    );

    return {
      ...zone,
      object_count: zoneObjects.length,
      active_object_count: activeObjectCount,
      unknown_count: unknownCount,
      objects: objectsWithContents,
    };
  });

  return {
    farmKey: "elm_farm",
    zones: registry,
  };
}
