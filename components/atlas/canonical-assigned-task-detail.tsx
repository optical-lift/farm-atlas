import BuyerOutreachTaskDetail from "@/components/atlas/buyer-outreach-task-detail";
import ContractorServiceTaskDetail from "@/components/atlas/contractor-service-task-detail";
import DecisionSelectorTaskDetail from "@/components/atlas/decision-selector-task-detail";
import DirectSowTaskDetail from "@/components/atlas/direct-sow-task-detail";
import ExecutionChecklistTaskDetail from "@/components/atlas/execution-checklist-task-detail";
import FlowerFulfillmentTaskLoader from "@/components/atlas/flower-fulfillment-task-loader";
import FlowerPreparationTaskLoader from "@/components/atlas/flower-preparation-task-loader";
import MowCardTaskDetail from "@/components/atlas/mow-card-task-detail";
import NetworkInputsTaskDetail from "@/components/atlas/network-inputs-task-detail";
import NetworkOutreachTaskDetail from "@/components/atlas/network-outreach-task-detail";
import ProjectPullTaskDetail from "@/components/atlas/project-pull-task-detail";
import SeedInventoryTaskLoader from "@/components/atlas/seed-inventory-task-loader";
import TransplantReadinessTaskDetail from "@/components/atlas/transplant-readiness-task-detail";
import WeedCardTaskLoader from "@/components/atlas/weed-card-task-loader";
import WeeklyHarvestTaskDetail from "@/components/atlas/weekly-harvest-task-detail";
import WorkerReadyAssignedTaskExecutionShell from "@/components/atlas/worker-ready-assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { normalizeWorkerReadiness, type WorkerReadinessResponse } from "@/lib/atlas/worker-readiness";
import { createAtlasServerClient } from "@/lib/supabase/server";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

function isContractorServiceTask(task: AtlasTaskCard) {
  return task.task_type === "contractor_service_status"
    || task.metadata?.task_style === "contractor_service_status";
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

function isDirectSowTask(task: AtlasTaskCard) {
  return task.task_type === "sowing"
    && task.action_key === "sow"
    && task.metadata?.operation_result_membrane === "or3_direct_sow_seed_v1"
    && (task.metadata?.seed_inventory_report_required === true || task.metadata?.seed_inventory_report_required === "true");
}

function isMowTask(task: AtlasTaskCard) {
  return task.task_type === "mowing";
}

function isWeedTask(task: AtlasTaskCard) {
  return task.action_key === "weed"
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

function isExecutionChecklistTask(task: AtlasTaskCard) {
  return typeof task.metadata?.execution_checklist_template_key === "string"
    && task.metadata.execution_checklist_template_key.length > 0;
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

export default async function CanonicalAssignedTaskDetail(props: Props) {
  if (isContractorServiceTask(props.task)) return <ContractorServiceTaskDetail {...props} />;
  if (isDecisionSelectorTask(props.task)) return <DecisionSelectorTaskDetail {...props} />;
  if (isDirectSowTask(props.task)) return <DirectSowTaskDetail task={props.task} assignee={props.assignee} />;
  if (isMowTask(props.task)) return <MowCardTaskDetail task={props.task} assignee={props.assignee} />;
  if (isWeedTask(props.task)) return <WeedCardTaskLoader {...props} />;
  if (isSeedInventoryTask(props.task)) return <SeedInventoryTaskLoader {...props} />;
  if (isBuyerOutreachTask(props.task)) return <BuyerOutreachTaskDetail {...props} />;
  if (isNetworkOutreachTask(props.task)) return <NetworkOutreachTaskDetail {...props} />;
  if (isNetworkInputsTask(props.task)) return <NetworkInputsTaskDetail {...props} />;
  if (isExecutionChecklistTask(props.task)) return <ExecutionChecklistTaskDetail {...props} />;
  if (isProjectPullTask(props.task)) return <ProjectPullTaskDetail {...props} />;
  if (isTransplantReadinessTask(props.task)) return <TransplantReadinessTaskDetail {...props} />;
  if (isFlowerPreparationTask(props.task)) return <FlowerPreparationTaskLoader {...props} />;
  if (isFlowerFulfillmentTask(props.task)) return <FlowerFulfillmentTaskLoader {...props} />;
  if (isWeeklyHarvestTask(props.task)) return <WeeklyHarvestTaskDetail {...props} />;

  const initialReadiness = await loadWorkerReadiness(props.task.task_id);
  return <WorkerReadyAssignedTaskExecutionShell {...props} initialReadiness={initialReadiness} />;
}
