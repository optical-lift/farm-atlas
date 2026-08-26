import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import type { AtlasBedMap, AtlasCropOccupancyCohort } from "@/lib/atlas/weed-card-contract";
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
  stable_key?: string | null;
  label?: string | null;
  zone_id?: string | null;
};

type WeedCardRow = {
  id: string;
  current_condition?: string | null;
  target_condition?: string | null;
  next_review_on?: string | null;
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

type TrailTaskRow = {
  id: string;
  title: string;
  action_key?: string | null;
  completed_at?: string | null;
  due_date?: string | null;
  created_at?: string | null;
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

function cropDisplay(cropLabel: string, variety: string | null) {
  if (!variety) return cropLabel;
  if (cropLabel.toLowerCase().includes(variety.toLowerCase())) return cropLabel;
  return `${variety} ${cropLabel}`;
}

function trailKind(action: string | null | undefined) {
  switch ((action || "").toLowerCase()) {
    case "sow": return "Sown";
    case "plant": return "Planted";
    case "transplant": return "Transplanted";
    case "deadhead": return "Deadheaded";
    case "pinch": return "Pinched";
    case "prune": return "Pruned";
    case "cut_back": return "Cut back";
    default: return "Tended";
  }
}

function occupancyCohorts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as AtlasCropOccupancyCohort[];
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return [] as AtlasCropOccupancyCohort[];
  return groups.flatMap((group) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    const cohorts = (group as { cohorts?: unknown }).cohorts;
    return Array.isArray(cohorts) ? cohorts as AtlasCropOccupancyCohort[] : [];
  });
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
  if (taskError) return atlasApiError(500, "turnover_task_read_failed", "Atlas could not load the clear task.");
  if (!taskData) return atlasApiError(404, "turnover_task_not_found", "The clear task was not found.");

  const task = taskData as TaskRow;
  const metadata = task.metadata ?? {};
  if (text(metadata.weed_management_mode) !== "clear_selected_crop") {
    return atlasApiError(400, "turnover_mode_required", "This task is not a selected-crop clear action.");
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
    ? await supabase.schema("atlas").from("growing_objects").select("id, stable_key, label, zone_id").in("id", objectIds)
    : { data: [], error: null };
  if (objectError) return atlasApiError(500, "turnover_location_read_failed", "Atlas could not load where this crop lives.");
  const objectRows = (objectData ?? []) as ObjectRow[];
  const labelById = new Map(objectRows.map((row) => [row.id, text(row.label)]));
  const locations = objectIds.map((id) => labelById.get(id) || "").filter(Boolean);

  const [mapResults, occupancyResults] = await Promise.all([
    Promise.all(objectIds.map(async (objectId) => {
      const result = await supabase.rpc("object_crop_bed_map_v1", { p_object_id: objectId });
      if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) return null;
      return result.data as AtlasBedMap;
    })),
    Promise.all(objectIds.map(async (objectId) => {
      const result = await supabase.rpc("object_crop_occupancy_v1", { p_object_id: objectId });
      return result.error ? null : result.data;
    })),
  ]);
  const bedMaps = mapResults.filter((map): map is AtlasBedMap => map !== null);

  const cohorts = new Map<string, AtlasCropOccupancyCohort>();
  for (const occupancy of occupancyResults) {
    for (const cohort of occupancyCohorts(occupancy)) {
      const key = cohort.cropCycleId || `${cohort.displayLabel}:${cohort.placementId || ""}`;
      if (!cohorts.has(key)) cohorts.set(key, cohort);
    }
  }
  const occupancyGroups = cohorts.size
    ? [{ groupKind: "observed", groupDate: null, groupLabel: "Current crops", cohorts: Array.from(cohorts.values()) }]
    : [];

  const cropLabel = text(cycle.crop_label) || "Selected crop";
  const variety = text(cycle.variety) || null;
  const selectedCrop = cropDisplay(cropLabel, variety);
  const destination = text(metadata.biomass_destination) || "compost";
  const collectionLabel = text(metadata.turnover_collection_label)
    || text(metadata.display_location)
    || locations.join(" + ")
    || "Bed";
  const executionDo = text(metadata.execution_do)
    || `Remove the ${selectedCrop} crop biomass and take it to the ${destination}.`;
  const doneWhen = text(metadata.execution_done_when)
    || `The ${selectedCrop} crop body is removed and its biomass is in the ${destination}.`;

  let zoneLabel = "Elm Farm";
  const zoneId = objectRows.map((row) => text(row.zone_id)).find(Boolean);
  if (zoneId) {
    const zoneResult = await supabase.schema("atlas").from("zones").select("label").eq("id", zoneId).limit(1).maybeSingle();
    if (!zoneResult.error && text(zoneResult.data?.label)) zoneLabel = text(zoneResult.data?.label);
  }

  const { data: weedCardData } = objectIds.length
    ? await supabase.schema("atlas").from("weed_cards").select("id, current_condition, target_condition, next_review_on").in("object_id", objectIds)
    : { data: [] };
  const weedCards = (weedCardData ?? []) as WeedCardRow[];
  const weedCardIds = weedCards.map((row) => row.id);
  const { data: sessionData } = weedCardIds.length
    ? await supabase.schema("atlas").from("weed_sessions").select("id, work_date, minutes, minutes_known, condition_before, condition_after, note, recorded_at").in("weed_card_id", weedCardIds).order("recorded_at", { ascending: false }).limit(12)
    : { data: [] };
  const rawSessions = (sessionData ?? []) as WeedSessionRow[];
  const sessions = rawSessions.map((session) => ({
    id: session.id,
    workDate: session.work_date,
    minutes: session.minutes ?? 0,
    minutesKnown: Boolean(session.minutes_known),
    conditionBefore: session.condition_before,
    conditionAfter: session.condition_after,
    note: session.note,
    recordedAt: session.recorded_at,
  }));

  let bedTrail: Array<Record<string, unknown>> = [];
  if (objectIds.length) {
    const linkResult = await supabase.schema("atlas").from("task_objects").select("task_id").in("object_id", objectIds);
    const taskIds = Array.from(new Set((linkResult.data ?? []).map((row) => text(row.task_id)).filter((id) => id && id !== taskId)));
    if (taskIds.length) {
      const trailResult = await supabase.schema("atlas").from("tasks").select("id, title, action_key, completed_at, due_date, created_at").in("id", taskIds).eq("status", "done");
      const trailTasks = (trailResult.data ?? []) as TrailTaskRow[];
      bedTrail = trailTasks
        .map((row) => ({
          taskId: row.id,
          eventKind: trailKind(row.action_key),
          cropLabel: null,
          title: row.title,
          eventDate: text(row.completed_at).slice(0, 10) || text(row.due_date) || text(row.created_at).slice(0, 10),
        }))
        .filter((row) => row.eventDate)
        .sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)))
        .slice(0, 5);
    }
  }

  const firstWeedCard = weedCards[0];
  const lastSession = sessions[0];
  const fallbackCondition = text(firstWeedCard?.current_condition) || "clear";

  return privateJson({
    ok: true,
    card: {
      taskId,
      taskStatus: "open",
      taskDueDate: null,
      cardId: firstWeedCard?.id || `bed-work:${taskId}`,
      passId: null,
      passStatus: "closed",
      objectId: objectIds[0] || "",
      objectKey: objectRows.map((row) => text(row.stable_key)).filter(Boolean).join("+") || collectionLabel,
      objectLabel: collectionLabel,
      zoneLabel,
      mainCropLabel: selectedCrop,
      occupancyGroups,
      bedMap: bedMaps[0] || null,
      condition: fallbackCondition,
      targetCondition: text(firstWeedCard?.target_condition) || fallbackCondition,
      lastWeededOn: lastSession?.workDate || null,
      lastLoggedCondition: lastSession?.conditionAfter || fallbackCondition,
      lastLoggedOn: lastSession?.workDate || null,
      bedUseCategory: "Bed work",
      bedTrail,
      totalMinutes: sessions.reduce((sum, session) => sum + (session.minutes || 0), 0),
      sessionCount: sessions.length,
      nextReviewOn: firstWeedCard?.next_review_on || null,
      sessions,
    },
    turnover: {
      taskId,
      collectionLabel,
      cropCycleId,
      cropLabel,
      variety,
      cycleState: text(cycle.cycle_state) || null,
      locations,
      bedMaps,
      biomassDestination: destination,
      executionDo,
      doneWhen,
      preserveOtherCrops: metadata.other_crop_bodies_preserved !== false,
      wholeBedTurnover: metadata.whole_bed_turnover === true,
    },
  });
}
