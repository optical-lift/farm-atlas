import ThinCropCycleFocusPage, { type ThinCropCycleFocusTask } from "@/app/task-focus/[taskId]/ThinCropCycleFocusPage";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { createAtlasServerClient } from "@/lib/supabase/server";

type Props = { task: AtlasTaskCard; assignee: AtlasAssigneeConfig };
type SuccessionRow = { sequence_number?: number | null; sow_task_id?: string | null };
type SowTaskRow = { metadata?: Record<string, unknown> | null };

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function numberOrNull(value: unknown) { const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN; return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }

export default async function ThinCropCycleTaskDetail({ task, assignee }: Props) {
  const metadata = task.metadata ?? {};
  const cropCycleId = text(metadata.crop_cycle_id);
  const supabase = await createAtlasServerClient();
  let successionNumber: number | null = null;
  let sowMetadata: Record<string, unknown> = {};

  if (cropCycleId) {
    const succession = await supabase
      .schema("atlas")
      .from("production_successions")
      .select("sequence_number, sow_task_id")
      .eq("crop_cycle_id", cropCycleId)
      .order("sequence_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (succession.error) console.error("Thin crop-cycle succession lookup failed.", succession.error);
    const row = succession.data as SuccessionRow | null;
    successionNumber = numberOrNull(row?.sequence_number);
    const sowTaskId = text(row?.sow_task_id);
    if (sowTaskId) {
      const source = await supabase.schema("atlas").from("tasks").select("metadata").eq("id", sowTaskId).limit(1).maybeSingle();
      if (source.error) console.error("Thin source sow lookup failed.", source.error);
      sowMetadata = ((source.data as SowTaskRow | null)?.metadata ?? {}) as Record<string, unknown>;
    }
  }

  const focus: ThinCropCycleFocusTask = {
    id: task.task_id,
    dueDate: task.due_date,
    cropLabel: text(metadata.crop_label) || text(metadata.crop) || "Crop",
    variety: text(metadata.variety) || text(metadata.crop_variety) || null,
    locationLabel: text(metadata.display_detail) || text(metadata.display_location) || text(metadata.collection_label) || "Elm Farm",
    zoneLabel: text(task.zone_label) || text(metadata.collection_zone) || null,
    rowsPerBed: numberOrNull(metadata.rows_per_3ft_bed),
    targetSpacingInches: numberOrNull(metadata.target_spacing_inches) || numberOrNull(metadata.in_row_spacing_in),
    projectedHarvestStart: text(metadata.projected_harvest_start) || text(sowMetadata.projected_harvest_start) || null,
    projectedHarvestEnd: text(metadata.projected_harvest_end) || text(sowMetadata.projected_harvest_end) || null,
    projectedClearDate: text(metadata.projected_clear_bed_date) || text(sowMetadata.projected_clear_bed_date) || null,
    successionNumber,
    actionKey: task.action_key || null,
    workClass: task.work_class || null,
    returnTo: assignee.listPath,
  };

  return <ThinCropCycleFocusPage task={focus} />;
}
