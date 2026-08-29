import BuyerOutreachTaskDetail from "@/components/atlas/buyer-outreach-task-detail";
import ContractorServiceTaskDetail from "@/components/atlas/contractor-service-task-detail";
import CropMoveTaskDetail from "@/components/atlas/crop-move-task-detail";
import DecisionSelectorTaskDetail from "@/components/atlas/decision-selector-task-detail";
import DirectHarvestTaskDetail from "@/components/atlas/direct-harvest-task-detail";
import DirectSowTaskDetail from "@/components/atlas/direct-sow-task-detail";
import ExecutionChecklistTaskDetail from "@/components/atlas/execution-checklist-task-detail";
import FarmRoundTaskDetail from "@/components/atlas/farm-round-task-detail";
import FlowerFulfillmentTaskLoader from "@/components/atlas/flower-fulfillment-task-loader";
import FlowerPreparationTaskLoader from "@/components/atlas/flower-preparation-task-loader";
import NetworkInputsTaskDetail from "@/components/atlas/network-inputs-task-detail";
import NetworkOutreachTaskDetail from "@/components/atlas/network-outreach-task-detail";
import OneOffMowingTaskDetail from "@/components/atlas/one-off-mowing-task-detail";
import PhoneOutreachTaskDetail from "@/components/atlas/phone-outreach-task-detail";
import ProductionHardeningTaskDetail from "@/components/atlas/production-hardening-task-detail";
import ProjectPullTaskDetail from "@/components/atlas/project-pull-task-detail";
import SeedInventoryTaskLoader from "@/components/atlas/seed-inventory-task-loader";
import SiteLayoutTaskDetail from "@/components/atlas/site-layout-task-detail";
import TransplantReadinessTaskDetail from "@/components/atlas/transplant-readiness-task-detail";
import VegetationControlTaskDetail from "@/components/atlas/vegetation-control-task-detail";
import VenueResetTaskDetail from "@/components/atlas/venue-reset-task-detail";
import VenueTaskDetail from "@/components/atlas/venue-task-detail";
import WeedCardTaskLoader from "@/components/atlas/weed-card-task-loader";
import WeeklyFoodHarvestTaskDetail from "@/components/atlas/weekly-food-harvest-task-detail";
import WeeklyHarvestTaskDetail from "@/components/atlas/weekly-harvest-task-detail";
import WorkerReadyAssignedTaskExecutionShell from "@/components/atlas/worker-ready-assigned-task-execution-shell";
import { loadDirectHarvestContext } from "@/lib/atlas/direct-harvest-context";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { normalizeWorkerReadiness, type WorkerReadinessResponse } from "@/lib/atlas/worker-readiness";
import { createAtlasServerClient } from "@/lib/supabase/server";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type SetupRecipeRow = {
  label?: string | null;
  required_resource_keys?: string[] | null;
  optional_resource_keys?: string[] | null;
};

type SetupResourceRow = {
  stable_key?: string | null;
  label?: string | null;
};

const VENUE_STATION_TEMPLATES = new Set([
  "community_thursday_morning_outdoor_v2",
  "community_thursday_morning_coffee_water_v2",
  "community_thursday_morning_rooms_v2",
  "community_thursday_venue_tidy_v1",
  "community_thursday_venue_prep_v1",
  "community_thursday_venue_host_v1",
]);

function isContractorServiceTask(task: AtlasTaskCard) {
  return task.task_type === "contractor_service_status"
    || task.metadata?.task_style === "contractor_service_status";
}

function isDirectHarvestTask(task: AtlasTaskCard) {
  return task.task_type === "owner_decision"
    && task.metadata?.task_style === "flower_preparation_directive_review"
    && String(task.metadata?.flower_preparation_directive_review_version ?? "") === "1";
}

function isDecisionSelectorTask(task: AtlasTaskCard) {
  return task.metadata?.task_style === "decision_selector"
    && typeof task.metadata?.decision_selector_key === "string"
    && task.metadata.decision_selector_key.length > 0;
}

function isProjectPullTask(task: AtlasTaskCard) {
  return typeof task.metadata?.project_pull_item_id === "string"
    && task.metadata.project_pull_item_id.length > 0;
}

function isSowCardTask(task: AtlasTaskCard) {
  return task.task_type === "sowing"
    && task.action_key === "sow"
    && (
      task.metadata?.task_style === "sowing"
      || task.metadata?.operation_result_membrane === "or3_direct_sow_seed_v1"
    );
}

function isOneOffMowingCardTask(task: AtlasTaskCard) {
  const clockManaged = task.metadata?.clock_managed === true || task.metadata?.clock_managed === "true";
  return task.task_type === "mowing"
    && task.action_key === "mow"
    && !clockManaged
    && task.operation_class === "cut_separate"
    && typeof task.metadata?.execution_place === "string"
    && task.metadata.execution_place.trim().length > 0
    && task.metadata?.target_cut_height_inches !== null
    && task.metadata?.target_cut_height_inches !== undefined;
}

function isSprayTreatmentTask(task: AtlasTaskCard) {
  return task.action_key === "spray" && task.operation_class === "apply_treatment";
}

function isWeedTask(task: AtlasTaskCard) {
  return task.metadata?.canonical_card_family === "weed"
    || task.action_key === "weed"
    || task.task_type === "weed"
    || task.metadata?.work_route === "weed"
    || /^weed\b/i.test(task.title.trim());
}

function isSeedInventoryTask(task: AtlasTaskCard) {
  return task.task_type === "seed_inventory_recount"
    || task.action_key === "recount_seed_inventory"
    || task.metadata?.task_style === "seed_inventory_recount";
}

function isBuyerOutreachTask(task: AtlasTaskCard) {
  return task.metadata?.buyer_outreach_mode === "sales";
}

function isPhoneOutreachTask(task: AtlasTaskCard) {
  return task.metadata?.task_style === "phone_outreach"
    || task.metadata?.checklist_mode === "phone_outreach";
}

function isNetworkOutreachTask(task: AtlasTaskCard) {
  return task.metadata?.network_outreach_master_task === true
    || task.metadata?.checklist_mode === "network_outreach";
}

function isNetworkInputsTask(task: AtlasTaskCard) {
  return task.metadata?.network_input_research === true
    || task.metadata?.network_input_master_task === true
    || task.metadata?.checklist_mode === "network_input_research"
    || task.metadata?.task_key === "anna_20260728_call_local_companies_florist_buckets"
    || task.metadata?.task_key === "anna_20260730_source_free_farm_inputs";
}

function isFarmRoundTask(task: AtlasTaskCard) {
  return task.task_type === "stewardship_round"
    && (task.metadata?.farm_round_parent === true || task.metadata?.farm_round_parent === "true");
}

function isCropMoveTask(task: AtlasTaskCard) {
  return task.task_type === "pot_up"
    || task.action_key === "pot_up"
    || (task.task_type === "transplanting" && task.operation_class === "divide_reestablish_belowground");
}

function isResetTask(task: AtlasTaskCard) {
  return task.operation_class === "clean_restore";
}

function isVenueTask(task: AtlasTaskCard) {
  const template = task.metadata?.execution_checklist_template_key;
  return task.task_type === "event_setup"
    && task.metadata?.collection_zone === "Venue"
    && typeof template === "string"
    && VENUE_STATION_TEMPLATES.has(template);
}

function isExecutionChecklistTask(task: AtlasTaskCard) {
  return typeof task.metadata?.execution_checklist_template_key === "string"
    && task.metadata.execution_checklist_template_key.length > 0;
}

function isProductionHardeningTask(task: AtlasTaskCard) {
  return task.task_type === "hardening_off"
    && task.action_key === "hardening_off"
    && task.metadata?.continuity_contract === "seedling_care_to_hardening_to_transplant_v1"
    && typeof task.metadata?.production_lot_id === "string"
    && typeof task.metadata?.production_tray_batch_id === "string";
}

function isTransplantReadinessTask(task: AtlasTaskCard) {
  return task.task_type === "transplant_readiness"
    || task.metadata?.task_style === "transplant_readiness"
    || task.metadata?.requires_transplant_readiness_check === true
    || task.metadata?.requires_transplant_readiness_check === "true";
}

function isFlowerPreparationTask(task: AtlasTaskCard) {
  return task.task_type === "flower_preparation"
    || task.metadata?.task_style === "flower_preparation";
}

function isFlowerFulfillmentTask(task: AtlasTaskCard) {
  return task.task_type === "flower_fulfillment"
    || task.metadata?.task_style === "flower_fulfillment";
}

function isWeeklyHarvestTask(task: AtlasTaskCard) {
  return task.task_type === "harvest"
    && (task.metadata?.weekly_routine === true || task.metadata?.weekly_routine === "true");
}

function isWeeklyFoodHarvestTask(task: AtlasTaskCard) {
  return task.task_type === "food_harvest"
    && task.metadata?.result_contract === "weekly_food_harvest_round_v1";
}

function isSiteLayoutTask(task: AtlasTaskCard) {
  return task.task_type === "site_layout";
}

async function loadWorkerReadiness(taskId: string): Promise<WorkerReadinessResponse> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_task_execution_readiness_api_v1", {
    p_task_id: taskId,
  });
  if (error) {
    console.error("Task execution readiness failed during Task Focus render.", error);
    return { ok: false, error: "Task readiness could not be loaded." };
  }
  return normalizeWorkerReadiness(data);
}

async function loadSiteLayoutRecipe(task: AtlasTaskCard) {
  if (!task.action_key) return { label: null as string | null, tools: [] as string[] };
  const supabase = await createAtlasServerClient();
  const { data: farm } = await supabase
    .schema("atlas")
    .from("farms")
    .select("id")
    .eq("stable_key", task.farm_key)
    .limit(1)
    .maybeSingle();
  if (!farm?.id) return { label: null as string | null, tools: [] as string[] };

  const { data: recipe, error: recipeError } = await supabase
    .schema("atlas")
    .from("action_requirement_templates")
    .select("label, required_resource_keys, optional_resource_keys")
    .eq("farm_id", farm.id)
    .eq("action_type", task.action_key)
    .eq("applies_to_task_type", task.task_type)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recipeError) console.error("Setup recipe lookup failed.", recipeError);
  const row = recipe as SetupRecipeRow | null;
  const keys = Array.from(new Set([...(row?.required_resource_keys ?? []), ...(row?.optional_resource_keys ?? [])].filter(Boolean)));
  if (!keys.length) return { label: row?.label?.trim() || null, tools: [] as string[] };

  const { data: resources, error: resourceError } = await supabase
    .schema("atlas")
    .from("resources")
    .select("stable_key, label")
    .eq("farm_id", farm.id)
    .in("stable_key", keys);
  if (resourceError) console.error("Setup resource-label lookup failed.", resourceError);
  const labelByKey = new Map(((resources ?? []) as SetupResourceRow[]).map((resource) => [resource.stable_key || "", resource.label?.trim() || ""]));
  return {
    label: row?.label?.trim() || null,
    tools: keys.map((key) => labelByKey.get(key) || "").filter(Boolean),
  };
}

export default async function CanonicalAssignedTaskDetail(props: Props) {
  if (isContractorServiceTask(props.task)) return <ContractorServiceTaskDetail {...props} />;
  if (isDirectHarvestTask(props.task)) {
    const initialContext = await loadDirectHarvestContext(props.task);
    return <DirectHarvestTaskDetail task={props.task} assignee={props.assignee} initialContext={initialContext} />;
  }
  if (isDecisionSelectorTask(props.task)) return <DecisionSelectorTaskDetail {...props} />;
  if (isSowCardTask(props.task)) return <DirectSowTaskDetail task={props.task} assignee={props.assignee} />;
  if (isOneOffMowingCardTask(props.task)) return <OneOffMowingTaskDetail task={props.task} assignee={props.assignee} />;
  if (isSprayTreatmentTask(props.task)) return <VegetationControlTaskDetail {...props} />;
  if (isWeedTask(props.task)) return <WeedCardTaskLoader {...props} />;
  if (isSeedInventoryTask(props.task)) return <SeedInventoryTaskLoader {...props} />;
  if (isBuyerOutreachTask(props.task)) return <BuyerOutreachTaskDetail {...props} />;
  if (isPhoneOutreachTask(props.task)) return <PhoneOutreachTaskDetail {...props} />;
  if (isNetworkOutreachTask(props.task)) return <NetworkOutreachTaskDetail {...props} />;
  if (isNetworkInputsTask(props.task)) return <NetworkInputsTaskDetail {...props} />;
  if (isFarmRoundTask(props.task)) return <FarmRoundTaskDetail {...props} />;
  if (isCropMoveTask(props.task)) return <CropMoveTaskDetail {...props} />;
  if (isResetTask(props.task)) return <VenueResetTaskDetail {...props} />;
  if (isVenueTask(props.task)) return <VenueTaskDetail {...props} />;
  if (isExecutionChecklistTask(props.task)) return <ExecutionChecklistTaskDetail {...props} />;
  if (isProjectPullTask(props.task)) return <ProjectPullTaskDetail {...props} />;
  if (isProductionHardeningTask(props.task)) return <ProductionHardeningTaskDetail {...props} />;
  if (isTransplantReadinessTask(props.task)) return <TransplantReadinessTaskDetail {...props} />;
  if (isFlowerPreparationTask(props.task)) return <FlowerPreparationTaskLoader {...props} />;
  if (isFlowerFulfillmentTask(props.task)) return <FlowerFulfillmentTaskLoader {...props} />;
  if (isWeeklyFoodHarvestTask(props.task)) return <WeeklyFoodHarvestTaskDetail {...props} />;
  if (isWeeklyHarvestTask(props.task)) return <WeeklyHarvestTaskDetail {...props} />;

  const initialReadiness = await loadWorkerReadiness(props.task.task_id);
  if (isSiteLayoutTask(props.task)) {
    const recipe = await loadSiteLayoutRecipe(props.task);
    return <SiteLayoutTaskDetail {...props} initialReadiness={initialReadiness} recipeLabel={recipe.label} recipeTools={recipe.tools} />;
  }
  return <WorkerReadyAssignedTaskExecutionShell {...props} initialReadiness={initialReadiness} />;
}
