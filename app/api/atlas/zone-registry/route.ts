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
  object_id: string;
  content_label: string;
  content_type: string;
  variety: string | null;
  planted_date: string | null;
  status: string;
  confidence: string;
  note: string | null;
};

function isRegistryHidden(row: { current_state?: string | null; metadata?: Record<string, unknown> | null }) {
  return row.current_state === "archived" || row.metadata?.registry_hidden === true;
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
        .select("object_id, content_label, content_type, variety, planted_date, status, confidence, note")
        .in("object_id", objectIds)
        .order("planted_date", { ascending: false })
    : { data: [], error: null };

  if (contentsError) {
    return NextResponse.json(
      { ok: false, error: "Object content registry read failed.", details: contentsError.message },
      { status: 500 },
    );
  }

  const contentByObject = new Map<string, ContentRow[]>();

  ((contents ?? []) as ContentRow[]).forEach((content) => {
    const list = contentByObject.get(content.object_id) ?? [];
    list.push(content);
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
    const objectsWithContents = zoneObjects.map((object) => ({
      ...object,
      contents: contentByObject.get(object.id) ?? [],
    }));

    const activeObjectCount = objectsWithContents.filter((object) => object.contents.length > 0).length;

    return {
      ...zone,
      object_count: zoneObjects.length,
      active_object_count: activeObjectCount,
      objects: objectsWithContents,
    };
  });

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    zones: registry,
  });
}
