import DirectSowFocusPage, { type DirectSowFocusTask } from "@/app/task-focus/[taskId]/DirectSowFocusPage";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { createAtlasServerClient } from "@/lib/supabase/server";

type Props = {
  task: AtlasTaskCard;
  assignee: AtlasAssigneeConfig;
};

type CropCycleTargetRow = {
  object_id?: string | null;
};

type GrowingObjectTargetRow = {
  label?: string | null;
  zone_id?: string | null;
};

type ZoneRow = {
  label?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

async function successionNumberForTask(task: AtlasTaskCard) {
  const supabase = await createAtlasServerClient();
  const direct = await supabase
    .schema("atlas")
    .from("production_successions")
    .select("sequence_number")
    .eq("sow_task_id", task.task_id)
    .order("sequence_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  const directNumber = numberOrNull(direct.data?.sequence_number);
  if (directNumber) return directNumber;
  if (direct.error) console.error("Sow succession task lookup failed.", direct.error);

  const cropCycleId = text(task.metadata?.crop_cycle_id);
  if (!cropCycleId) return null;

  const byCycle = await supabase
    .schema("atlas")
    .from("production_successions")
    .select("sequence_number")
    .eq("crop_cycle_id", cropCycleId)
    .order("sequence_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (byCycle.error) {
    console.error("Sow succession crop-cycle lookup failed.", byCycle.error);
    return null;
  }
  return numberOrNull(byCycle.data?.sequence_number);
}

async function canonicalSowTarget(task: AtlasTaskCard) {
  const cropCycleId = text(task.metadata?.crop_cycle_id);
  if (!cropCycleId) return { targetLabel: null as string | null, zoneLabel: null as string | null };
  const supabase = await createAtlasServerClient();
  const { data: cycle, error: cycleError } = await supabase
    .schema("atlas")
    .from("crop_cycles")
    .select("object_id")
    .eq("id", cropCycleId)
    .limit(1)
    .maybeSingle();
  if (cycleError) console.error("Sow crop-cycle target lookup failed.", cycleError);
  const objectId = text((cycle as CropCycleTargetRow | null)?.object_id);
  if (!objectId) return { targetLabel: null as string | null, zoneLabel: null as string | null };

  const { data: object, error: objectError } = await supabase
    .schema("atlas")
    .from("growing_objects")
    .select("label, zone_id")
    .eq("id", objectId)
    .limit(1)
    .maybeSingle();
  if (objectError) console.error("Sow growing-object target lookup failed.", objectError);
  const target = object as GrowingObjectTargetRow | null;
  const zoneId = text(target?.zone_id);
  let zoneLabel: string | null = null;
  if (zoneId) {
    const { data: zone, error: zoneError } = await supabase
      .schema("atlas")
      .from("zones")
      .select("label")
      .eq("id", zoneId)
      .limit(1)
      .maybeSingle();
    if (zoneError) console.error("Sow target-zone lookup failed.", zoneError);
    zoneLabel = text((zone as ZoneRow | null)?.label) || null;
  }
  return { targetLabel: text(target?.label) || null, zoneLabel };
}

export default async function DirectSowTaskDetail({ task, assignee }: Props) {
  const metadata = task.metadata ?? {};
  const [successionNumber, canonicalTarget] = await Promise.all([
    successionNumberForTask(task),
    canonicalSowTarget(task),
  ]);
  const explicitTargets = stringList(metadata.target_labels);
  const metadataLocation = text(metadata.execution_place) || text(metadata.display_location) || text(metadata.collection_label);
  const targetLabels = explicitTargets.length
    ? explicitTargets
    : canonicalTarget.targetLabel
      ? [canonicalTarget.targetLabel]
      : metadataLocation
        ? [metadataLocation]
        : [];
  const locationLabel = targetLabels[0] || text(metadata.display_detail) || text(metadata.collection_zone) || "Elm Farm";
  const inventoryResult = metadata.operation_result_membrane === "or3_direct_sow_seed_v1"
    && (metadata.seed_inventory_report_required === true || metadata.seed_inventory_report_required === "true");

  const focus: DirectSowFocusTask = {
    id: task.task_id,
    title: task.title,
    dueDate: task.due_date,
    cropLabel: text(metadata.crop_label) || "Crop",
    variety: text(metadata.variety) || null,
    locationLabel,
    zoneLabel: text(task.zone_label) || canonicalTarget.zoneLabel || text(metadata.collection_zone) || null,
    targetLabels,
    rowsPerBed: numberOrNull(metadata.rows_per_3ft_bed),
    spacingInches: numberOrNull(metadata.in_row_spacing_in),
    seedRequirementQuantity: numberOrNull(metadata.seed_requirement_quantity),
    seedRequirementUnit: text(metadata.seed_requirement_unit) || null,
    projectedGerminationStart: text(metadata.projected_germination_start) || null,
    projectedGerminationEnd: text(metadata.projected_germination_end) || null,
    projectedHarvestStart: text(metadata.projected_harvest_start) || null,
    projectedHarvestEnd: text(metadata.projected_harvest_end) || null,
    projectedClearDate: text(metadata.projected_clear_bed_date) || null,
    successionNumber,
    completionMode: inventoryResult ? "seed_inventory" : "canonical",
    actionKey: task.action_key || null,
    workClass: task.work_class || null,
    returnTo: assignee.listPath,
  };

  return <DirectSowFocusPage task={focus} />;
}
