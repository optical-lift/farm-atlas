import DirectSowFocusPage, { type DirectSowFocusTask } from "@/app/task-focus/[taskId]/DirectSowFocusPage";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

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

export default function DirectSowTaskDetail({ task, assignee }: Props) {
  const metadata = task.metadata ?? {};
  const focus: DirectSowFocusTask = {
    id: task.task_id,
    title: task.title,
    dueDate: task.due_date,
    cropLabel: text(metadata.crop_label) || "Crop",
    variety: text(metadata.variety) || null,
    locationLabel: text(metadata.execution_place) || text(metadata.display_location) || text(metadata.collection_label) || "Growing bed",
    zoneLabel: text(metadata.collection_zone) || null,
    targetLabels: stringList(metadata.target_labels),
    rowsPerBed: numberOrNull(metadata.rows_per_3ft_bed),
    spacingInches: numberOrNull(metadata.in_row_spacing_in),
    seedRequirementQuantity: numberOrNull(metadata.seed_requirement_quantity),
    seedRequirementUnit: text(metadata.seed_requirement_unit) || null,
    projectedGerminationStart: text(metadata.projected_germination_start) || null,
    projectedGerminationEnd: text(metadata.projected_germination_end) || null,
    projectedHarvestStart: text(metadata.projected_harvest_start) || null,
    projectedHarvestEnd: text(metadata.projected_harvest_end) || null,
    projectedClearDate: text(metadata.projected_clear_bed_date) || null,
    executionHow: stringList(metadata.execution_how),
    actionKey: task.action_key || null,
    workClass: task.work_class || null,
    returnTo: assignee.listPath,
  };

  return <DirectSowFocusPage task={focus} />;
}
