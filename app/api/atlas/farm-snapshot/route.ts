import { NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type ObjectRow = {
  id: string;
  object_type: string | null;
  length_ft: number | null;
  width_ft: number | null;
  area_sqft: number | null;
};

type ContentRow = {
  object_id: string;
  status: string | null;
};

type EventRow = {
  event_type: string;
  event_date: string;
  quantity: number | null;
  unit: string | null;
};

type FieldLogRow = {
  action_types: string[] | null;
  log_date: string;
  metadata: Record<string, unknown> | null;
};

const inactiveStatuses = new Set(["archived", "cleared", "dead", "empty", "failed", "removed"]);
const sowingEvents = new Set(["seeded", "sowed", "sowing_recorded"]);

function areaForObject(object: ObjectRow) {
  if (typeof object.area_sqft === "number") return object.area_sqft;
  if (typeof object.length_ft === "number" && typeof object.width_ft === "number") return object.length_ft * object.width_ft;
  return 0;
}

function isActiveStatus(status: string | null) {
  if (!status) return false;
  return !inactiveStatuses.has(status);
}

function isStemUnit(unit: string | null) {
  return (unit ?? "").toLowerCase().includes("stem");
}

export async function GET() {
  const yearStart = `${new Date().getFullYear()}-01-01`;

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

  const [objectsResponse, contentsResponse, eventsResponse, logsResponse] = await Promise.all([
    atlasSupabase
      .schema("atlas")
      .from("growing_objects")
      .select("id, object_type, length_ft, width_ft, area_sqft")
      .eq("farm_id", farm.id),
    atlasSupabase
      .schema("atlas")
      .from("object_contents")
      .select("object_id, status")
      .eq("farm_id", farm.id),
    atlasSupabase
      .schema("atlas")
      .from("object_activity_events")
      .select("event_type, event_date, quantity, unit")
      .eq("farm_id", farm.id)
      .gte("event_date", yearStart),
    atlasSupabase
      .schema("atlas")
      .from("field_logs")
      .select("action_types, log_date, metadata")
      .eq("farm_id", farm.id)
      .gte("log_date", yearStart),
  ]);

  const firstError = objectsResponse.error ?? contentsResponse.error ?? eventsResponse.error ?? logsResponse.error;
  if (firstError) {
    return NextResponse.json(
      { ok: false, error: "Atlas farm snapshot read failed.", details: firstError.message },
      { status: 500 },
    );
  }

  const objects = (objectsResponse.data ?? []) as ObjectRow[];
  const contents = (contentsResponse.data ?? []) as ContentRow[];
  const events = (eventsResponse.data ?? []) as EventRow[];
  const logs = (logsResponse.data ?? []) as FieldLogRow[];
  const objectsById = new Map(objects.map((object) => [object.id, object]));

  const activeObjectIds = new Set(contents.filter((content) => isActiveStatus(content.status)).map((content) => content.object_id));
  const activeSqft = Array.from(activeObjectIds).reduce((sum, objectId) => sum + areaForObject(objectsById.get(objectId) as ObjectRow), 0);

  const sowingEventCount = events.filter((event) => sowingEvents.has(event.event_type)).length;
  const sowingLogCount = logs.filter((log) => (log.action_types ?? []).some((action) => action.toLowerCase().includes("sow") || action.toLowerCase().includes("seed"))).length;
  const stemsLogged = events
    .filter((event) => event.event_type === "harvested" && isStemUnit(event.unit))
    .reduce((sum, event) => sum + (typeof event.quantity === "number" ? event.quantity : 0), 0);

  return NextResponse.json({
    ok: true,
    farmKey: "elm_farm",
    snapshot: {
      totalBeds: objects.filter((object) => object.object_type === "bed").length,
      growingBeds: activeObjectIds.size,
      activeSqft: Math.round(activeSqft),
      sowingsLogged: sowingEventCount + sowingLogCount,
      stemsLogged: Math.round(stemsLogged),
    },
  });
}
