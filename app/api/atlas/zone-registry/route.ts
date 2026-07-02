import { NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

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

type ZoneRow = {
  id: string;
  stable_key: string;
  label: string;
  zone_type: string | null;
  mode_bias: string | null;
  goal_text: string | null;
  current_state: string | null;
  sort_order: number | null;
  metadata?: Record<string, unknown> | null;
};

type ObjectRow = {
  id: string;
  zone_id: string | null;
  stable_key: string;
  label: string;
  object_type: string;
  object_mode: string | null;
  length_ft: number | null;
  width_ft: number | null;
  sort_order: number | null;
  metadata?: Record<string, unknown> | null;
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

type EventRow = {
  id: string;
  object_id: string;
  object_content_id: string | null;
  event_type: string;
  event_date: string;
  note: string | null;
};

function isRegistryHidden(row: { current_state?: string | null; metadata?: Record<string, unknown> | null }) {
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
    (event) => !event.object_content_id || event.object_content_id === content.id,
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

export async function GET() {
  const { data: farm, error: farmError } = await atlasSupabase
    .schema("atlas")
    .from("farms")
    .select("id")
    .eq("stable_key", "elm_farm")
    .single();

  if (farmError || !farm) {
    return NextResponse.json(
      { ok: false, error: "Elm Farm was not found.", details: farmError?.message },
      { status: 500 },
    );
  }

  const { data: zones, error: zonesError } = await atlasSupabase
    .schema("atlas")
    .from("zones")
    .select("id, stable_key, label, zone_type, mode_bias, goal_text, current_state, sort_order, metadata")
    .eq("farm_id", farm.id)
    .in("stable_key", FINAL_ZONE_KEYS)
    .order("sort_order", { ascending: true });

  if (zonesError) {
    return NextResponse.json(
      { ok: false, error: "Zone registry read failed.", details: zonesError.message },
      { status: 500 },
    );
  }

  const visibleZones = ((zones ?? []) as ZoneRow[]).filter((zone) => !isRegistryHidden(zone));
  const visibleZoneIds = new Set(visibleZones.map((zone) => zone.id));

  const { data: objects, error: objectsError } = await atlasSupabase
    .schema("atlas")
    .from("growing_objects")
    .select("id, zone_id, stable_key, label, object_type, object_mode, length_ft, width_ft, sort_order, metadata")
    .eq("farm_id", farm.id)
    .order("sort_order", { ascending: true });

  if (objectsError) {
    return NextResponse.json(
      { ok: false, error: "Growing object registry read failed.", details: objectsError.message },
      { status: 500 },
    );
  }

  const visibleObjects = ((objects ?? []) as ObjectRow[]).filter((object) => {
    if (!object.zone_id || !visibleZoneIds.has(object.zone_id)) return false;
    return object.metadata?.registry_hidden !== true;
  });

  const objectIds = visibleObjects.map((object) => object.id);

  const { data: contents, error: contentsError } = objectIds.length
    ? await atlasSupabase
        .schema("atlas")
        .from("object_contents")
        .select(
          "id, object_id, content_label, content_type, variety, planted_date, status, confidence, start_method, germinated_date, pinch_required, pinch_note, bloom_start_date, clear_bed_date, next_crop_planned, expected_germination_start, expected_germination_end, expected_harvest_watch_start, expected_harvest_watch_end, expected_clear_date, note",
        )
        .in("object_id", objectIds)
        .order("planted_date", { ascending: false })
    : { data: [], error: null };

  if (contentsError) {
    return NextResponse.json(
      { ok: false, error: "Object content registry read failed.", details: contentsError.message },
      { status: 500 },
    );
  }

  const { data: events, error: eventsError } = objectIds.length
    ? await atlasSupabase
        .schema("atlas")
        .from("object_activity_events")
        .select("id, object_id, object_content_id, event_type, event_date, note")
        .in("object_id", objectIds)
        .order("event_date", { ascending: true })
    : { data: [], error: null };

  if (eventsError) {
    return NextResponse.json(
      { ok: false, error: "Object activity read failed.", details: eventsError.message },
      { status: 500 },
    );
  }

  const eventsByObject = new Map<string, EventRow[]>();

  ((events ?? []) as EventRow[]).forEach((event) => {
    const list = eventsByObject.get(event.object_id) ?? [];
    list.push(event);
    eventsByObject.set(event.object_id, list);
  });

  const contentByObject = new Map<string, Array<ContentRow & { inspection: ReturnType<typeof inspectionFor> }>>();

  ((contents ?? []) as ContentRow[]).forEach((content) => {
    const objectEvents = eventsByObject.get(content.object_id) ?? [];
    const list = contentByObject.get(content.object_id) ?? [];
    list.push({
      ...content,
      inspection: inspectionFor(content, objectEvents),
    });
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
      (sum, object) =>
        sum +
        object.contents.reduce(
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

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    zones: registry,
  });
}
