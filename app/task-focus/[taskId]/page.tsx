import { notFound } from "next/navigation";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import CanonicalAssignedTaskDetail from "@/components/atlas/canonical-assigned-task-detail";
import { resolveTaskAssignee } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import GerminationFocusPage from "./GerminationFocusPage";
import SowingFocusPage, { type ProductionSowingTask } from "./SowingFocusPage";
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

function isProductionSowingTask(task: TaskRow) {
  const metadata = task.metadata ?? {};
  return task.task_type === "production_sowing" && Boolean(text(metadata.production_succession_id));
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

async function loadGenericTaskDetail(taskId: string) {
  const [{ data: taskCard, error: taskError }, { data: childCards, error: childrenError }] = await Promise.all([
    atlasSupabase
      .schema("atlas")
      .from("v_task_cards")
      .select("*")
      .eq("farm_key", "elm_farm")
      .eq("task_id", taskId)
      .limit(1)
      .maybeSingle(),
    atlasSupabase
      .schema("atlas")
      .from("v_task_cards")
      .select("*")
      .eq("farm_key", "elm_farm")
      .eq("parent_task_id", taskId)
      .neq("status", "archived")
      .order("created_at", { ascending: true }),
  ]);

  if (taskError) throw new Error(taskError.message);
  if (childrenError) throw new Error(childrenError.message);
  if (!taskCard) return null;

  return {
    task: taskCard as AtlasTaskCard,
    children: (childCards ?? []) as AtlasTaskCard[],
  };
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

async function loadProductionSowingTask(task: TaskRow): Promise<ProductionSowingTask | null> {
  const successionId = text(task.metadata?.production_succession_id);
  if (!successionId) return null;

  const { data: succession, error: successionError } = await atlasSupabase
    .schema("atlas")
    .from("production_successions")
    .select("id, production_plan_id, sequence_number, planned_window_start, planned_window_end, late_window_end, skip_after_date, projected_germination_start, projected_germination_end, projected_harvest_start, projected_harvest_end, projected_clear_date, state")
    .eq("id", successionId)
    .limit(1)
    .maybeSingle();
  if (successionError) throw new Error(successionError.message);
  if (!succession) return null;

  const { data: plan, error: planError } = await atlasSupabase
    .schema("atlas")
    .from("production_plans")
    .select("id, crop_profile_id, succession_count, missed_strategy, protect_final_succession, final_biological_sow_date, intended_uses")
    .eq("id", succession.production_plan_id)
    .single();
  if (planError) throw new Error(planError.message);

  const [{ data: profile, error: profileError }, { data: next, error: nextError }] = await Promise.all([
    atlasSupabase.schema("atlas").from("crop_profiles").select("crop_label, variety").eq("id", plan.crop_profile_id).single(),
    atlasSupabase.schema("atlas").from("production_successions").select("planned_window_start, planned_window_end").eq("production_plan_id", succession.production_plan_id).eq("sequence_number", succession.sequence_number + 1).limit(1).maybeSingle(),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (nextError) throw new Error(nextError.message);

  return {
    taskId: task.id,
    successionId: succession.id,
    cropLabel: text(profile.crop_label) || text(task.metadata?.crop_label) || "Crop",
    variety: text(profile.variety) || text(task.metadata?.variety) || null,
    sequenceNumber: succession.sequence_number,
    successionCount: plan.succession_count,
    plannedWindowStart: succession.planned_window_start,
    plannedWindowEnd: succession.planned_window_end,
    lateWindowEnd: succession.late_window_end,
    skipAfterDate: succession.skip_after_date,
    nextWindowStart: next?.planned_window_start ?? null,
    nextWindowEnd: next?.planned_window_end ?? null,
    finalBiologicalSowDate: plan.final_biological_sow_date,
    projectedGerminationStart: succession.projected_germination_start,
    projectedGerminationEnd: succession.projected_germination_end,
    projectedHarvestStart: succession.projected_harvest_start,
    projectedHarvestEnd: succession.projected_harvest_end,
    projectedClearDate: succession.projected_clear_date,
    state: succession.state,
    missedStrategy: plan.missed_strategy as "skip" | "merge" | "preserve",
    protectFinalSuccession: plan.protect_final_succession,
    intendedUses: Array.isArray(plan.intended_uses) ? plan.intended_uses : [],
  };
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

  if (isProductionSowingTask(task)) {
    const productionTask = await loadProductionSowingTask(task);
    if (productionTask) return <SowingFocusPage task={productionTask} />;
  }

  if (!isGerminationTask(task)) {
    const detail = await loadGenericTaskDetail(task.id);
    if (!detail) notFound();
    return <CanonicalAssignedTaskDetail task={detail.task} childTasks={detail.children} assignee={resolveTaskAssignee(task)} />;
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
