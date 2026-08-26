import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
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
    ? await supabase.schema("atlas").from("growing_objects").select("id, label").in("id", objectIds)
    : { data: [], error: null };
  if (objectError) return atlasApiError(500, "turnover_location_read_failed", "Atlas could not load where this crop lives.");
  const objectRows = (objectData ?? []) as ObjectRow[];
  const labelById = new Map(objectRows.map((row) => [row.id, text(row.label)]));
  const locations = objectIds.map((id) => labelById.get(id) || "").filter(Boolean);

  const cropLabel = text(cycle.crop_label) || "Selected crop";
  const variety = text(cycle.variety) || null;
  const destination = text(metadata.biomass_destination) || "compost";
  const collectionLabel = text(metadata.turnover_collection_label)
    || text(metadata.display_location)
    || locations.join(" + ")
    || "Bed turnover";
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
      biomassDestination: destination,
      executionDo,
      doneWhen,
      preserveOtherCrops: metadata.other_crop_bodies_preserved !== false,
      wholeBedTurnover: metadata.whole_bed_turnover === true,
    },
  });
}
