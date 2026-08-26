import { NextResponse } from "next/server";

import { atlasApiError, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import type { AtlasBedMap, AtlasCropOccupancyCohort } from "@/lib/atlas/weed-card-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  metadata?: Record<string, unknown> | null;
};

type TurnoverBed = {
  objectId?: string | null;
  objectKey?: string | null;
  objectLabel?: string | null;
  cardId?: string | null;
  occupancyGroups?: unknown;
};

type TurnoverCrop = {
  cropCycleId?: string | null;
  cropLabel?: string | null;
  variety?: string | null;
  cycleState?: string | null;
  biomassDestination?: string | null;
};

type TurnoverFocus = {
  mode?: string | null;
  taskStatus?: string | null;
  taskDueDate?: string | null;
  zoneLabel?: string | null;
  collectionLabel?: string | null;
  selectedCrop?: TurnoverCrop | null;
  beds?: TurnoverBed[] | null;
  capacitySurfaces?: TurnoverBed[] | null;
  wholeBedTurnover?: boolean | null;
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

function cohortsFromGroups(value: unknown) {
  if (!Array.isArray(value)) return [] as AtlasCropOccupancyCohort[];
  return value.flatMap((group) => {
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
  const [{ data: taskData, error: taskError }, { data: focusData, error: focusError }] = await Promise.all([
    supabase.schema("atlas").from("tasks").select("id, metadata").eq("id", taskId).limit(1).maybeSingle(),
    supabase.rpc("weed_selected_crop_turnover_focus_v1", { p_task_id: taskId }),
  ]);

  if (taskError) return atlasApiError(500, "turnover_task_read_failed", "Atlas could not load the clear task.");
  if (!taskData) return atlasApiError(404, "turnover_task_not_found", "The clear task was not found.");
  if (focusError?.code === "42501") return atlasApiError(403, "turnover_forbidden", "This Clear bed card is not available to the signed-in farm member.");
  if (focusError?.code === "P0002") return atlasApiError(404, "turnover_focus_not_found", "The Clear bed card could not resolve its crop body.");
  if (focusError) return atlasApiError(500, "turnover_focus_read_failed", "Atlas could not load the Clear bed card.");
  if (!focusData || typeof focusData !== "object" || Array.isArray(focusData)) {
    return atlasApiError(404, "turnover_focus_not_found", "The Clear bed card was not found.");
  }

  const task = taskData as TaskRow;
  const metadata = task.metadata ?? {};
  const focus = focusData as TurnoverFocus;
  if (text(focus.mode) !== "clear_selected_crop" || text(metadata.weed_management_mode) !== "clear_selected_crop") {
    return atlasApiError(400, "turnover_mode_required", "This task is not a selected-crop clear action.");
  }

  const beds = Array.isArray(focus.beds) ? focus.beds : [];
  const capacitySurfaces = Array.isArray(focus.capacitySurfaces) ? focus.capacitySurfaces : [];
  const selected = focus.selectedCrop ?? {};
  const cropCycleId = text(selected.cropCycleId);
  if (!cropCycleId) return atlasApiError(409, "turnover_crop_missing", "The crop to clear is not linked to this task.");

  const cropLabel = text(selected.cropLabel) || text(metadata.selected_crop_label) || "Selected crop";
  const variety = text(selected.variety) || null;
  const selectedCrop = cropDisplay(cropLabel, variety);
  const destination = text(selected.biomassDestination) || text(metadata.biomass_destination) || "compost";
  const collectionLabel = text(focus.collectionLabel)
    || text(metadata.turnover_collection_label)
    || text(metadata.display_location)
    || "Bed";
  const zoneLabel = text(focus.zoneLabel) || "Elm Farm";
  const executionDo = text(metadata.execution_do)
    || `Remove the ${selectedCrop} crop biomass and take it to the ${destination}.`;
  const doneWhen = text(metadata.execution_done_when)
    || `The ${selectedCrop} crop body is removed and its biomass is in the ${destination}.`;

  // The bed-work card is owned by the physical bed being tended. A linked arch or
  // trellis is a capacity surface used by the crop, not a replacement card subject.
  // Active Crops still merges both scopes so Atlas can show the vine on its support.
  const mapSources = beds.length ? beds : capacitySurfaces;
  const mapResults = await Promise.all(mapSources.flatMap((surface) => {
    const objectId = text(surface.objectId);
    if (!objectId) return [];
    return [supabase.rpc("object_crop_bed_map_v1", { p_object_id: objectId })];
  }));
  const bedMaps = mapResults.flatMap((result) => {
    if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) return [];
    return [result.data as AtlasBedMap];
  });

  const cohorts = new Map<string, AtlasCropOccupancyCohort>();
  for (const scope of [...beds, ...capacitySurfaces]) {
    for (const cohort of cohortsFromGroups(scope.occupancyGroups)) {
      const key = cohort.cropCycleId || `${cohort.displayLabel}:${cohort.placementId || ""}`;
      if (!cohorts.has(key)) cohorts.set(key, cohort);
    }
  }
  const occupancyGroups = cohorts.size
    ? [{ groupKind: "observed", groupDate: null, groupLabel: "Current crops", cohorts: Array.from(cohorts.values()) }]
    : [];

  const locations = capacitySurfaces.map((surface) => text(surface.objectLabel)).filter(Boolean);
  const firstBed = beds[0];
  const firstCardId = beds.map((bed) => text(bed.cardId)).find(Boolean);

  return privateJson({
    ok: true,
    card: {
      taskId,
      taskStatus: text(focus.taskStatus) || "open",
      taskDueDate: text(focus.taskDueDate) || null,
      cardId: firstCardId || `bed-work:${taskId}`,
      passId: null,
      passStatus: "closed",
      objectId: text(firstBed?.objectId) || text(mapSources[0]?.objectId),
      objectKey: beds.map((bed) => text(bed.objectKey)).filter(Boolean).join("+") || collectionLabel,
      objectLabel: collectionLabel,
      zoneLabel,
      mainCropLabel: selectedCrop,
      occupancyGroups,
      bedMap: bedMaps[0] || null,
      condition: "clear",
      targetCondition: "clear",
      lastWeededOn: null,
      lastLoggedCondition: "clear",
      lastLoggedOn: null,
      bedUseCategory: "Bed work",
      bedTrail: [],
      totalMinutes: 0,
      sessionCount: 0,
      nextReviewOn: null,
      sessions: [],
    },
    turnover: {
      taskId,
      collectionLabel,
      cropCycleId,
      cropLabel,
      variety,
      cycleState: text(selected.cycleState) || null,
      locations,
      bedMaps,
      biomassDestination: destination,
      executionDo,
      doneWhen,
      preserveOtherCrops: metadata.other_crop_bodies_preserved !== false,
      wholeBedTurnover: focus.wholeBedTurnover === true || metadata.whole_bed_turnover === true,
    },
  });
}
