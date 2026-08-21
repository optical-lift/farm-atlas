import DirectSowFocusPage, { type DirectSowFocusTask } from "@/app/task-focus/[taskId]/DirectSowFocusPage";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { createAtlasServerClient } from "@/lib/supabase/server";

type Props = {
  task: AtlasTaskCard;
  assignee: AtlasAssigneeConfig;
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

export default async function DirectSowTaskDetail({ task, assignee }: Props) {
  const metadata = task.metadata ?? {};
  const successionNumber = await successionNumberForTask(task);
  const explicitTargets = stringList(metadata.target_labels);
  const locationLabel = text(metadata.execution_place) || text(metadata.display_location) || text(metadata.collection_label) || "Growing bed";
  const inventoryResult = metadata.operation_result_membrane === "or3_direct_sow_seed_v1"
    && (metadata.seed_inventory_report_required === true || metadata.seed_inventory_report_required === "true");

  const focus: DirectSowFocusTask = {
    id: task.task_id,
    title: task.title,
    dueDate: task.due_date,
    cropLabel: text(metadata.crop_label) || "Crop",
    variety: text(metadata.variety) || null,
    locationLabel,
    zoneLabel: text(metadata.collection_zone) || null,
    targetLabels: explicitTargets.length ? explicitTargets : [locationLabel],
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
