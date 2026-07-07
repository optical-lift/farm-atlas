import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: string;
  checklistStatus?: "open" | "done";
  plantedAmount?: number | string | null;
  plantedLocation?: string | null;
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

async function writePlantingLog({
  task,
  metadata,
  amount,
  location,
  now,
}: {
  task: { id: string; farm_id: string; zone_id: string | null; title: string; due_date: string | null };
  metadata: Record<string, unknown>;
  amount: number;
  location: string;
  now: string;
}) {
  const cropLabel = clean(metadata.planting_log_crop_label) || "Dahlia";
  const variety = clean(metadata.planting_log_variety) || clean(metadata.checklist_label) || task.title.replace(/^Checklist\s+—\s+/i, "");
  const unit = clean(metadata.planting_log_unit) || "plants";
  const plantedDate = now.slice(0, 10);
  const cropProfileId = await cropProfileIdFor(cropLabel);
  const summary = `Planted ${amount} ${unit} ${variety} in ${location}`;

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
        location,
      },
    })
    .select("id")
    .single();
  if (fieldLogError) throw new Error(fieldLogError.message);

  const { error: plantingError } = await atlasSupabase
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
        location,
      },
    });
  if (plantingError) throw new Error(plantingError.message);

  return { summary, cropLabel, variety, amount, unit, location, fieldLogId: fieldLog?.id ?? null };
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
    const location = clean(body.plantedLocation) || clean(currentMetadata.planting_log_default_location) || clean(currentMetadata.display_detail) || "Elm Farm";
    const plantingLog = shouldLogPlanting(currentMetadata, checklistStatus) && amount !== null
      ? await writePlantingLog({ task, metadata: currentMetadata, amount, location, now })
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
      zone_id: task.zone_id,
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
