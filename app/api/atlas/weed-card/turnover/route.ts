import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import type {
  AtlasBedMap,
  AtlasCropOccupancyGroup,
  AtlasWeedBedTrailEvent,
  AtlasWeedCondition,
  AtlasWeedSession,
} from "@/lib/atlas/weed-card-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  metadata?: Record<string, unknown> | null;
};

type CropCycleRow = {
  id: string;
  object_id?: string | null;
  crop_label?: string | null;
  variety?: string | null;
  cycle_state?: string | null;
};

type PlacementRow = {
  object_id?: string | null;
  placement_label?: string | null;
};

type ObjectRow = {
  id: string;
  label?: string | null;
  zone_id?: string | null;
};

type TaskHistoryRow = {
  id: string;
  title?: string | null;
  action_key?: string | null;
  task_type?: string | null;
  status?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
};

type WeedCardRow = {
  id: string;
  last_session_at?: string | null;
};

type WeedSessionRow = {
  id: string;
  work_date: string;
  minutes: number | null;
  minutes_known: boolean | null;
  condition_before: string;
  condition_after: string;
  note: string | null;
  recorded_at: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function eventKind(row: TaskHistoryRow) {
  const action = text(row.action_key).toLowerCase();
  if (action === "sow") return "Sown";
  if (action === "plant") return "Planted";
  if (action === "transplant") return "Transplanted";
  if (action === "deadhead") return "Deadheaded";
  if (["divide", "cut_back", "prune", "tend", "perennial_tending", "pinch"].includes(action)) return "Tended";
  return "Worked";
}

function eventDate(row: TaskHistoryRow) {
  return text(row.completed_at).slice(0, 10)
    || text(row.due_date).slice(0, 10)
    || text(row.created_at).slice(0, 10);
}

function isBedTrailWork(row: TaskHistoryRow) {
  const action = text(row.action_key).toLowerCase();
  const taskType = text(row.task_type).toLowerCase();
  return ["sow", "plant", "transplant", "divide", "deadhead", "cut_back", "prune", "tend", "perennial_tending", "pinch"].includes(action)
    || ["sowing", "planting", "transplanting", "perennial_tending", "pinching"].includes(taskType);
}

function occupancyGroups(value: unknown): AtlasCropOccupancyGroup[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const groups = (value as { groups?: unknown }).groups;
  return Array.isArray(groups) ? groups as AtlasCropOccupancyGroup[] : [];
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
  if (!taskId) return atlasApiError(400, "turnover_task_required", "A task is required.");

  const supabase = await createAtlasServerClient();
  const { data: taskData, error: taskError } = await supabase
    .schema("atlas")
    .from("tasks")
    .select("id, metadata")
    .eq("id", taskId)
    .limit(1)
    .maybeSingle();
  if (taskError) return atlasApiError(500, "turnover_task_read_failed", "Atlas could not load the turnover task.");
  if (!taskData) return atlasApiError(404, "turnover_task_not_found", "The turnover task was not found.");

  const task = taskData as TaskRow;
  const metadata = task.metadata ?? {};
  if (text(metadata.weed_management_mode) !== "clear_selected_crop") {
    return atlasApiError(400, "turnover_mode_required", "This task is not a selected-crop turnover.");
  }

  const { data: linkData, error: linkError } = await supabase
    .schema("atlas")
    .from("task_crop_cycles")
    .select("crop_cycle_id")
    .eq("task_id", taskId)
    .eq("role", "clears")
    .limit(1)
    .maybeSingle();
  if (linkError) return atlasApiError(500, "turnover_crop_link_failed", "Atlas could not load the crop being cleared.");

  const cropCycleId = text((linkData as { crop_cycle_id?: string | null } | null)?.crop_cycle_id)
    || text(metadata.selected_crop_cycle_id)
    || text(metadata.source_crop_cycle_id)
    || text(metadata.crop_cycle_id);
  if (!cropCycleId) return atlasApiError(409, "turnover_crop_missing", "The crop to clear is not linked to this task.");

  const { data: cycleData, error: cycleError } = await supabase
    .schema("atlas")
    .from("crop_cycles")
    .select("id, object_id, crop_label, variety, cycle_state")
    .eq("id", cropCycleId)
    .limit(1)
    .maybeSingle();
  if (cycleError) return atlasApiError(500, "turnover_crop_read_failed", "Atlas could not load the crop being cleared.");
  if (!cycleData) return atlasApiError(409, "turnover_crop_missing", "The crop to clear no longer exists.");
  const cycle = cycleData as CropCycleRow;

  const { data: placementData, error: placementError } = await supabase
    .schema("atlas")
    .from("crop_placements")
    .select("object_id, placement_label")
    .eq("crop_cycle_id", cropCycleId);
  if (placementError) return atlasApiError(500, "turnover_placement_read_failed", "Atlas could not load where this crop lives.");
  const placements = (placementData ?? []) as PlacementRow[];
  const objectIds = Array.from(new Set(placements.map((placement) => text(placement.object_id)).filter(Boolean)));
  if (!objectIds.length && text(cycle.object_id)) objectIds.push(text(cycle.object_id));

  const { data: objectData, error: objectError } = objectIds.length
    ? await supabase.schema("atlas").from("growing_objects").select("id, label, zone_id").in("id", objectIds)
    : { data: [], error: null };
  if (objectError) return atlasApiError(500, "turnover_location_read_failed", "Atlas could not load where this crop lives.");
  const objectRows = (objectData ?? []) as ObjectRow[];
  const labelById = new Map(objectRows.map((row) => [row.id, text(row.label)]));
  const locations = objectIds.map((id) => labelById.get(id) || "").filter(Boolean);

  const zoneIds = Array.from(new Set(objectRows.map((row) => text(row.zone_id)).filter(Boolean)));
  let zoneLabel = "Elm Farm";
  if (zoneIds.length) {
    const { data: zones } = await supabase.schema("atlas").from("zones").select("id, label").in("id", zoneIds);
    const labels = Array.from(new Set((zones ?? []).map((zone) => text(zone.label)).filter(Boolean)));
    if (labels.length === 1) zoneLabel = labels[0];
    else if (labels.length > 1) zoneLabel = labels.join(" + ");
  }

  const [mapResults, occupancyResults] = await Promise.all([
    Promise.all(objectIds.map(async (objectId) => {
      const result = await supabase.rpc("object_crop_bed_map_v1", { p_object_id: objectId });
      if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) return null;
      return result.data as AtlasBedMap;
    })),
    Promise.all(objectIds.map(async (objectId) => {
      const result = await supabase.rpc("object_crop_occupancy_v1", { p_object_id: objectId });
      if (result.error) return [] as AtlasCropOccupancyGroup[];
      return occupancyGroups(result.data);
    })),
  ]);
  const bedMaps = mapResults.filter((map): map is AtlasBedMap => map !== null);
  const mergedOccupancyGroups = occupancyResults.flat();

  let bedTrail: AtlasWeedBedTrailEvent[] = [];
  if (objectIds.length) {
    const { data: taskObjectData } = await supabase
      .schema("atlas")
      .from("task_objects")
      .select("task_id")
      .in("object_id", objectIds);
    const historyTaskIds = Array.from(new Set((taskObjectData ?? []).map((row) => text(row.task_id)).filter(Boolean)));
    if (historyTaskIds.length) {
      const { data: historyData } = await supabase
        .schema("atlas")
        .from("tasks")
        .select("id, title, action_key, task_type, status, due_date, completed_at, created_at")
        .in("id", historyTaskIds)
        .eq("status", "done");
      bedTrail = ((historyData ?? []) as TaskHistoryRow[])
        .filter(isBedTrailWork)
        .map((row) => ({
          taskId: row.id,
          eventKind: eventKind(row),
          title: text(row.title) || "Bed work",
          eventDate: eventDate(row),
        }))
        .filter((row) => Boolean(row.eventDate))
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate))
        .slice(0, 5);
    }
  }

  let sessions: AtlasWeedSession[] = [];
  let lastWeededOn: string | null = null;
  if (objectIds.length) {
    const { data: weedCardData } = await supabase
      .schema("atlas")
      .from("weed_cards")
      .select("id, last_session_at")
      .in("object_id", objectIds);
    const weedCards = (weedCardData ?? []) as WeedCardRow[];
    const weedCardIds = weedCards.map((row) => row.id);
    if (weedCardIds.length) {
      const { data: sessionData } = await supabase
        .schema("atlas")
        .from("weed_sessions")
        .select("id, work_date, minutes, minutes_known, condition_before, condition_after, note, recorded_at")
        .in("weed_card_id", weedCardIds)
        .order("work_date", { ascending: false })
        .order("recorded_at", { ascending: false })
        .limit(12);
      sessions = ((sessionData ?? []) as WeedSessionRow[]).map((row) => ({
        id: row.id,
        workDate: row.work_date,
        minutes: row.minutes ?? 0,
        minutesKnown: row.minutes_known === true,
        conditionBefore: row.condition_before as AtlasWeedCondition,
        conditionAfter: row.condition_after as AtlasWeedCondition,
        note: row.note,
        recordedAt: row.recorded_at,
      }));
      lastWeededOn = sessions[0]?.workDate || null;
    }
    if (!lastWeededOn) {
      const dates = weedCards.map((row) => text(row.last_session_at).slice(0, 10)).filter(Boolean).sort().reverse();
      lastWeededOn = dates[0] || null;
    }
  }

  const cropLabel = text(cycle.crop_label) || "Selected crop";
  const variety = text(cycle.variety) || null;
  const destination = text(metadata.biomass_destination) || "compost";
  const collectionLabel = text(metadata.turnover_collection_label)
    || text(metadata.display_location)
    || locations.join(" + ")
    || "Bed";
  const executionDo = text(metadata.execution_do)
    || `Remove the ${cropLabel} crop biomass and take it to the ${destination}.`;
  const doneWhen = text(metadata.execution_done_when)
    || `The ${cropLabel} crop body is removed and its biomass is in the ${destination}.`;

  return privateJson({
    ok: true,
    turnover: {
      taskId,
      collectionLabel,
      cropCycleId,
      cropLabel,
      variety,
      cycleState: text(cycle.cycle_state) || null,
      locations,
      zoneLabel,
      occupancyGroups: mergedOccupancyGroups,
      bedTrail,
      bedMaps,
      sessions,
      lastWeededOn,
      biomassDestination: destination,
      executionDo,
      doneWhen,
      preserveOtherCrops: metadata.other_crop_bodies_preserved !== false,
      wholeBedTurnover: metadata.whole_bed_turnover === true,
    },
  });
}
