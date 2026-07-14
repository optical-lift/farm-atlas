import { notFound } from "next/navigation";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import GerminationFocusPage from "./GerminationFocusPage";
import GenericFocusPage from "./GenericFocusPage";
import "./focused-task-only.css";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  title: string;
  task_type: string | null;
  due_date: string | null;
  metadata: Record<string, unknown> | null;
};

type CycleRow = {
  crop_profile_id?: string | null;
  crop_label?: string | null;
  variety?: string | null;
  sown_date?: string | null;
  planted_date?: string | null;
  cycle_state?: string | null;
  expected_germination_start?: string | null;
  expected_germination_end?: string | null;
  expected_harvest_watch_start?: string | null;
  expected_harvest_watch_end?: string | null;
  planting_claim_id?: string | null;
};

type ProfileRow = {
  crop_label?: string | null;
  variety?: string | null;
  metadata?: Record<string, unknown> | null;
};

type CropContext = {
  cropLabel: string;
  variety: string | null;
  sownDate: string | null;
  plantedDate: string | null;
  plantingMethod: string | null;
  cycleState: string | null;
  expectedGerminationStart: string | null;
  expectedGerminationEnd: string | null;
  expectedHarvestStart: string | null;
  expectedHarvestEnd: string | null;
  targetSpacingInches: number | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function spacingFromProfile(metadata: Record<string, unknown> | null | undefined) {
  const direct = metadata?.target_spacing_inches;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  const lines = Array.isArray(metadata?.spacing_lines) ? metadata.spacing_lines : [];
  for (const line of lines) {
    if (typeof line !== "string") continue;
    const match = line.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches)\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function isGerminationTask(task: TaskRow) {
  const metadata = task.metadata ?? {};
  return task.task_type === "germination_check" || text(metadata.task_style) === "germination_check" || text(metadata.milestone) === "germination_check";
}

async function loadTask(taskId: string) {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("tasks")
    .select("id, title, task_type, due_date, metadata")
    .eq("id", taskId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as TaskRow | null) ?? null;
}

async function loadObjectLabel(taskId: string) {
  const { data } = await atlasSupabase
    .schema("atlas")
    .from("task_objects")
    .select("growing_objects(label)")
    .eq("task_id", taskId)
    .limit(1)
    .maybeSingle();

  const row = data as unknown as { growing_objects?: { label?: string } | null } | null;
  return text(row?.growing_objects?.label) || "Elm Farm";
}

async function loadCropContext(task: TaskRow): Promise<CropContext> {
  const metadata = task.metadata ?? {};
  let profileId = text(metadata.crop_profile_id);
  let cycleId = text(metadata.crop_cycle_id);

  if (!cycleId) {
    const cycleKey = text(metadata.crop_cycle_key);
    if (cycleKey) {
      const { data } = await atlasSupabase
        .schema("atlas")
        .from("crop_cycles")
        .select("id")
        .eq("crop_cycle_key", cycleKey)
        .limit(1)
        .maybeSingle();
      cycleId = text((data as { id?: string } | null)?.id);
    }
  }

  let cycle: CycleRow | null = null;
  if (cycleId) {
    const { data } = await atlasSupabase
      .schema("atlas")
      .from("crop_cycles")
      .select("crop_profile_id, crop_label, variety, sown_date, planted_date, cycle_state, expected_germination_start, expected_germination_end, expected_harvest_watch_start, expected_harvest_watch_end, planting_claim_id")
      .eq("id", cycleId)
      .limit(1)
      .maybeSingle();
    cycle = data as CycleRow | null;
    profileId = profileId || text(cycle?.crop_profile_id);
  }

  let profile: ProfileRow | null = null;
  if (profileId) {
    const { data } = await atlasSupabase
      .schema("atlas")
      .from("crop_profiles")
      .select("crop_label, variety, metadata")
      .eq("id", profileId)
      .limit(1)
      .maybeSingle();
    profile = data as ProfileRow | null;
  }

  let plantingMethod: string | null = null;
  const plantingClaimId = text(cycle?.planting_claim_id);
  if (plantingClaimId) {
    const { data } = await atlasSupabase
      .schema("atlas")
      .from("planting_claims")
      .select("planting_method")
      .eq("id", plantingClaimId)
      .limit(1)
      .maybeSingle();
    plantingMethod = text((data as { planting_method?: string | null } | null)?.planting_method) || null;
  }

  return {
    cropLabel: text(profile?.crop_label) || text(cycle?.crop_label) || text(metadata.crop_label) || text(metadata.crop) || task.title.split("—").pop()?.split("·")[0]?.trim() || "Crop",
    variety: text(profile?.variety) || text(cycle?.variety) || text(metadata.variety) || null,
    sownDate: text(cycle?.sown_date) || null,
    plantedDate: text(cycle?.planted_date) || null,
    plantingMethod,
    cycleState: text(cycle?.cycle_state) || null,
    expectedGerminationStart: text(cycle?.expected_germination_start) || null,
    expectedGerminationEnd: text(cycle?.expected_germination_end) || null,
    expectedHarvestStart: text(cycle?.expected_harvest_watch_start) || null,
    expectedHarvestEnd: text(cycle?.expected_harvest_watch_end) || null,
    targetSpacingInches: spacingFromProfile(profile?.metadata),
  };
}

export default async function TaskFocusPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = await loadTask(taskId);
  if (!task) notFound();

  if (!isGerminationTask(task)) {
    return <GenericFocusPage taskId={task.id} />;
  }

  const [objectLabel, crop] = await Promise.all([loadObjectLabel(task.id), loadCropContext(task)]);

  return (
    <div className="atlas-focused-task-only">
      <GerminationFocusPage
        task={{
          id: task.id,
          cropLabel: crop.cropLabel,
          variety: crop.variety,
          objectLabel,
          dueDate: task.due_date,
          sownDate: crop.sownDate,
          plantedDate: crop.plantedDate,
          plantingMethod: crop.plantingMethod,
          cycleState: crop.cycleState,
          expectedGerminationStart: crop.expectedGerminationStart,
          expectedGerminationEnd: crop.expectedGerminationEnd,
          expectedHarvestStart: crop.expectedHarvestStart,
          expectedHarvestEnd: crop.expectedHarvestEnd,
          targetSpacingInches: crop.targetSpacingInches,
        }}
      />
    </div>
  );
}
