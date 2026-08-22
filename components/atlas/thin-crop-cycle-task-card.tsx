"use client";

import ThinCropCycleFocusPage, { type ThinCropCycleFocusTask } from "@/app/task-focus/[taskId]/ThinCropCycleFocusPage";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function numberOrNull(value: unknown) { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }

export function isThinCropCycleTask(task: AtlasTaskCard) {
  return task.task_type === "thinning"
    && task.action_key === "thin"
    && task.operation_class === "remove_uproot"
    && Boolean(text(task.metadata?.crop_cycle_id));
}

export default function ThinCropCycleTaskCard({ task, assignee }: { task: AtlasTaskCard; assignee: AtlasAssigneeConfig }) {
  const metadata = task.metadata ?? {};
  const focus: ThinCropCycleFocusTask = {
    id: task.task_id,
    dueDate: task.due_date,
    cropLabel: text(metadata.crop_label) || text(metadata.crop) || "Crop",
    variety: text(metadata.variety) || text(metadata.crop_variety) || null,
    locationLabel: text(metadata.display_detail) || text(metadata.display_location) || text(metadata.collection_label) || "Elm Farm",
    zoneLabel: text(task.zone_label) || text(metadata.collection_zone) || null,
    rowsPerBed: numberOrNull(metadata.rows_per_3ft_bed),
    targetSpacingInches: numberOrNull(metadata.target_spacing_inches) || numberOrNull(metadata.in_row_spacing_in),
    projectedHarvestStart: text(metadata.projected_harvest_start) || null,
    projectedHarvestEnd: text(metadata.projected_harvest_end) || null,
    projectedClearDate: text(metadata.projected_clear_bed_date) || null,
    successionNumber: numberOrNull(metadata.succession_number),
    actionKey: task.action_key || null,
    workClass: task.work_class || null,
    returnTo: assignee.listPath,
  };
  return <ThinCropCycleFocusPage task={focus} />;
}
