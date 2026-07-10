import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  checklistStatus?: "open" | "done";
  plantedAmount?: number | string | null;
  plantedLocation?: string | null;
  plantedZoneId?: string | null;
  plantedObjectId?: string | null;
};

type Placement = {
  zoneId: string | null;
  zoneLabel: string | null;
  objectId: string | null;
  objectLabel: string | null;
  location: string;
};

const allowedPlantingMethods = new Set(["direct_sow", "transplant", "clump", "division", "start", "bulb", "seed_scatter", "full_bed_claim"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function plantingMethod(value: unknown) {
  const method = clean(value);
  return allowedPlantingMethods.has(method) ? method : "transplant";
}

function shouldLogPlanting(metadata: Record<string, unknown>, checklistStatus: "open" | "done") {
  return checklistStatus === "done" && (metadata.planting_log_required === true || metadata.planting_log_required === "true");
}

async function cropProfileIdFor(cropLabel: string) {
  const { data } = await atlasSupabase
    .schema("atlas")
    .from("crop_profiles")
    .select("id")
    .ilike("crop_label", cropLabel)
    .limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

async function placementFor({
  farmId,
  body,
  metadata,
}: {
  farmId: string;
  body: Body;
  metadata: Record<string, unknown>;
}): Promise<Placement> {
  const objectId = clean(body.plantedObjectId) || clean(metadata.planting_log_default_object_id);
  const zoneId = clean(body.plantedZoneId) || clean(metadata.planting_log_default_zone_id);
  const fallbackLocation = clean(body.plantedLocation) || clean(metadata.planting_log_default_location) || clean(metadata.display_detail) || "Elm Farm";

  if (objectId) {
    const { data: object, error: objectError } = await atlasSupabase
      .schema("atlas")
      .from("growing_objects")
      .select("id, label, zone_id")
      .eq("farm_id", farmId)
      .eq("id", objectId)
      .single();
    if (objectError || !object) throw new Error(objectError?.message || "Selected bed was not found.");

    const { data: zone } = object.zone_id
      ? await atlasSupabase
          .schema("atlas")
          .from("zones")
          .select("id, label")
          .eq("id", object.zone_id)
          .single()
      : { data: null };

    return {
      zoneId: ((zone?.id as string | undefined) ?? (object.zone_id as string | null) ?? zoneId) || null,
      zoneLabel: (zone?.label as string | undefined) ?? null,
      objectId: object.id as string,
      objectLabel: object.label as string,
      location: object.label as string,
    };
  }

  if (zoneId) {
    const { data: zone, error: zoneError } = await atlasSupabase
      .schema("atlas")
      .from("zones")
      .select("id, label")
      .eq("farm_id", farmId)
      .eq("id", zoneId)
      .single();
    if (zoneError || !zone) throw new Error(zoneError?.message || "Selected zone was not found.");

    return {
      zoneId: zone.id as string,
      zoneLabel: zone.label as string,
      objectId: null,
      objectLabel: null,
      location: fallbackLocation === "Elm Farm" ? zone.label as string : fallbackLocation,
    };
  }

  return {
    zoneId: null,
    zoneLabel: null,
    objectId: null,
    objectLabel: null,
    location: fallbackLocation,
  };
}

async function writePlantingLog({
  task,
  metadata,
  amount,
  placement,
  now,
}: {
  task: { id: string; farm_id: string; zone_id: string | null; title: string; due_date: string | null };
  metadata: Record<string, unknown>;
  amount: number;
  placement: Placement;
  now: string;
}) {
  const cropLabel = clean(metadata.planting_log_crop_label) || "Dahlia";
  const variety = clean(metadata.planting_log_variety) || clean(metadata.checklist_label) || task.title.replace(/^Checklist\s+—\s+/i, "");
  const unit = clean(metadata.planting_log_unit) || "plants";
  const plantedDate = now.slice(0, 10);
  const cropProfileId = await cropProfileIdFor(cropLabel);
  const summary = `Planted ${amount} ${unit} ${variety} in ${placement.location}`;

  const { data: fieldLog, error: fieldLogError } = await atlasSupabase
    .schema("atlas")
    .from("field_logs")
    .insert({
      farm_id: task.farm_id,
      log_date: plantedDate,
      action_types: ["plant", "planting", "checklist"],
      summary_sentence: summary,
      note: summary,
      source: "atlas_child_planting_log",
      metadata: {
        task_id: task.id,
        child_task_id: task.id,
        crop_label: cropLabel,
        variety,
        amount,
        unit,
        location: placement.location,
        zone_id: placement.zoneId,
        zone_label: placement.zoneLabel,
        object_id: placement.objectId,
        object_label: placement.objectLabel,
      },
    })
    .select("id")
    .single();
  if (fieldLogError) throw new Error(fieldLogError.message);

  const { data: plantingClaim, error: plantingError } = await atlasSupabase
    .schema("atlas")
    .from("planting_claims")
    .insert({
      farm_id: task.farm_id,
      field_log_id: fieldLog?.id,
      crop_profile_id: cropProfileId,
      crop_label: cropLabel,
      variety,
      planted_date: plantedDate,
      planting_method: plantingMethod(metadata.planting_method),
      amount,
      unit,
      status: "planted",
      confidence: "field_logged",
      note: summary,
      metadata: {
        task_id: task.id,
        child_task_id: task.id,
        parent_task_id: clean(metadata.parent_task_id) || null,
        location: placement.location,
        zone_id: placement.zoneId,
        zone_label: placement.zoneLabel,
        object_id: placement.objectId,
        object_label: placement.objectLabel,
      },
    })
    .select("id")
    .single();
  if (plantingError) throw new Error(plantingError.message);

  let objectContentId: string | null = null;
  let objectEventId: string | null = null;

  if (placement.objectId) {
    const { data: objectContent, error: contentError } = await atlasSupabase
      .schema("atlas")
      .from("object_contents")
      .insert({
        farm_id: task.farm_id,
        object_id: placement.objectId,
        planting_claim_id: plantingClaim?.id,
        crop_profile_id: cropProfileId,
        content_label: cropLabel,
        content_type: "planting",
        variety,
        planted_date: plantedDate,
        status: "planted",
        confidence: "field_logged",
        start_method: plantingMethod(metadata.planting_method),
        note: summary,
        metadata: {
          task_id: task.id,
          child_task_id: task.id,
          parent_task_id: clean(metadata.parent_task_id) || null,
          amount,
          unit,
          zone_label: placement.zoneLabel,
          object_label: placement.objectLabel,
        },
      })
      .select("id")
      .single();
    if (contentError) throw new Error(contentError.message);
    objectContentId = (objectContent?.id as string | undefined) ?? null;

    const { data: objectEvent, error: eventError } = await atlasSupabase
      .schema("atlas")
      .from("object_activity_events")
      .insert({
        farm_id: task.farm_id,
        object_id: placement.objectId,
        object_content_id: objectContentId,
        event_type: "planted",
        event_date: plantedDate,
        note: summary,
        quantity: amount,
        unit,
        source: "atlas_child_planting_log",
        metadata: {
          task_id: task.id,
          child_task_id: task.id,
          parent_task_id: clean(metadata.parent_task_id) || null,
          crop_label: cropLabel,
          variety,
          object_label: placement.objectLabel,
        },
      })
      .select("id")
      .single();
    if (eventError) throw new Error(eventError.message);
    objectEventId = (objectEvent?.id as string | undefined) ?? null;
  }

  return {
    summary,
    cropLabel,
    variety,
    amount,
    unit,
    location: placement.location,
    zoneId: placement.zoneId,
    zoneLabel: placement.zoneLabel,
    objectId: placement.objectId,
    objectLabel: placement.objectLabel,
    fieldLogId: fieldLog?.id ?? null,
    plantingClaimId: plantingClaim?.id ?? null,
    objectContentId,
    objectEventId,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    if (!body.taskId) return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 });
    const checklistStatus = body.checklistStatus === "done" ? "done" : "open";
    const now = new Date().toISOString();

    const { data: task, error: taskError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, title, task_type, zone_id, due_date, priority, metadata")
      .eq("id", body.taskId)
      .single();
    if (taskError || !task) throw new Error(taskError?.message || "Child task was not found.");

    const currentMetadata = ((task.metadata as Record<string, unknown> | null) ?? {});
    const parentTaskId = typeof currentMetadata.parent_task_id === "string" ? currentMetadata.parent_task_id : null;
    const defaultAmount = numberValue(currentMetadata.planting_log_default_amount);
    const amount = numberValue(body.plantedAmount) ?? defaultAmount;
    const placement = await placementFor({ farmId: task.farm_id, body, metadata: currentMetadata });
    const plantingLog = shouldLogPlanting(currentMetadata, checklistStatus) && amount !== null
      ? await writePlantingLog({ task, metadata: currentMetadata, amount, placement, now })
      : null;

    const metadata: Record<string, unknown> = {
      ...currentMetadata,
      checklist_status: checklistStatus,
      checklist_completed_at: checklistStatus === "done" ? now : null,
      ...(plantingLog ? { planting_log: { ...plantingLog, recorded_at: now } } : {}),
    };

    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({ status: "skipped", metadata, updated_at: now })
      .eq("id", body.taskId);
    if (updateError) throw new Error(updateError.message);

    await atlasSupabase.schema("atlas").from("task_outcome_events").insert({
      farm_id: task.farm_id,
      task_id: task.id,
      outcome: checklistStatus === "done" ? "done" : "partial",
      lane_key: "checklist",
      work_key: checklistStatus === "done" ? "checked" : "unchecked",
      note: plantingLog?.summary ?? (checklistStatus === "done" ? "Checklist item done" : "Checklist item reopened"),
      task_title: task.title,
      task_type: task.task_type,
      zone_id: plantingLog?.zoneId ?? task.zone_id,
      due_date: task.due_date,
      priority: task.priority,
      source: "atlas_child_checklist",
      metadata: { checklist_status: checklistStatus, parent_task_id: parentTaskId, planting_log: plantingLog },
    });

    return NextResponse.json({ ok: true, taskId: task.id, checklistStatus, plantingLog });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas child checklist failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
