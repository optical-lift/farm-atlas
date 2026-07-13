import { NextResponse } from "next/server";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ objectKey: string }> };

type PlantInstanceRow = {
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
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { objectKey: rawObjectKey } = await context.params;
    const objectKey = rawObjectKey.trim();

    if (!objectKey || objectKey.length > 160) {
      return NextResponse.json({ ok: false, error: "A valid object key is required." }, { status: 400 });
    }

    const { data: object, error: objectError } = await atlasSupabase
      .schema("atlas")
      .from("v_object_workbench")
      .select("*")
      .eq("farm_key", "elm_farm")
      .eq("object_key", objectKey)
      .maybeSingle();

    if (objectError) throw objectError;
    if (!object) {
      return NextResponse.json({ ok: false, error: "Atlas could not find this farm object." }, { status: 404 });
    }

    const [cyclesResult, plantsResult, eventsResult] = await Promise.all([
      atlasSupabase
        .schema("atlas")
        .from("crop_cycles")
        .select("id, crop_cycle_key, crop_label, variety, cycle_state, lifecycle_status, sown_date, planted_date, germination_checked_date, harvest_started_date, last_harvest_date, expected_germination_start, expected_germination_end, expected_harvest_watch_start, expected_harvest_watch_end, expected_clear_date, note")
        .eq("farm_id", object.farm_id)
        .eq("object_id", object.object_id)
        .eq("lifecycle_status", "active")
        .order("created_at", { ascending: true }),
      atlasSupabase
        .schema("atlas")
        .from("plant_instances")
        .select("id, lineage_id, stable_key, label, quantity, unit, generation, status, acquired_date, planted_date, note")
        .eq("farm_id", object.farm_id)
        .eq("object_id", object.object_id)
        .order("created_at", { ascending: true }),
      atlasSupabase
        .schema("atlas")
        .from("v_object_event_timeline")
        .select("event_id, object_id, object_key, object_label, field_log_id, crop_cycle_id, plant_instance_id, entity_label, entity_kind, event_type, event_date, note, quantity, unit, source, created_at")
        .eq("farm_id", object.farm_id)
        .eq("object_id", object.object_id)
        .order("event_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

    if (cyclesResult.error) throw cyclesResult.error;
    if (plantsResult.error) throw plantsResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const currentPlants = ((plantsResult.data ?? []) as PlantInstanceRow[]).filter(
      (plant) => !["dead", "removed", "archived"].includes(plant.status),
    );
    const lineageIds = Array.from(new Set(currentPlants.map((plant) => plant.lineage_id).filter(Boolean)));
    let lineages: Array<Record<string, unknown>> = [];

    if (lineageIds.length > 0) {
      const { data, error } = await atlasSupabase
        .schema("atlas")
        .from("plant_lineages")
        .select("id, stable_key, lineage_name, common_name, botanical_name, source_name, source_type, origin_year, origin_detail, propagation_goal")
        .in("id", lineageIds);
      if (error) throw error;
      lineages = data ?? [];
    }

    const lineageById = new Map(lineages.map((lineage) => [String(lineage.id), lineage]));
    const plantInstances = currentPlants.map((plant) => ({
      ...plant,
      lineage: lineageById.get(plant.lineage_id) ?? null,
    }));

    return NextResponse.json(
      {
        ok: true,
        object,
        cropCycles: cyclesResult.data ?? [],
        plantInstances,
        events: eventsResult.data ?? [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Atlas object workbench read failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Atlas object workbench read failed.",
        details: error instanceof Error ? error.message : "Unknown object read error.",
      },
      { status: 500 },
    );
  }
}
