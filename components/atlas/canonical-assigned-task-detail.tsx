"use client";

import AssignedTaskExecutionShell from "@/components/atlas/assigned-task-execution-shell";
import BuyerOutreachTaskDetail from "@/components/atlas/buyer-outreach-task-detail";
import ContractorServiceTaskDetail from "@/components/atlas/contractor-service-task-detail";
import DecisionSelectorTaskDetail from "@/components/atlas/decision-selector-task-detail";
import ExecutionChecklistTaskDetail from "@/components/atlas/execution-checklist-task-detail";
import NetworkInputsTaskDetail from "@/components/atlas/network-inputs-task-detail";
import NetworkOutreachTaskDetail from "@/components/atlas/network-outreach-task-detail";
import ProjectPullTaskDetail from "@/components/atlas/project-pull-task-detail";
import SeedInventoryTaskLoader from "@/components/atlas/seed-inventory-task-loader";
import TransplantReadinessTaskDetail from "@/components/atlas/transplant-readiness-task-detail";
import WeedCardTaskLoader from "@/components/atlas/weed-card-task-loader";
import WeeklyHarvestTaskDetail from "@/components/atlas/weekly-harvest-task-detail";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

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

function isWeeklyHarvestTask(task: AtlasTaskCard) {
  return task.task_type === "harvest"
    && (task.metadata?.weekly_routine === true || task.metadata?.weekly_routine === "true");
}

export default function CanonicalAssignedTaskDetail(props: Props) {
  if (isContractorServiceTask(props.task)) return <ContractorServiceTaskDetail {...props} />;
  if (isDecisionSelectorTask(props.task)) return <DecisionSelectorTaskDetail {...props} />;
  if (isWeedTask(props.task)) return <WeedCardTaskLoader {...props} />;
  if (isSeedInventoryTask(props.task)) return <SeedInventoryTaskLoader {...props} />;
  if (isBuyerOutreachTask(props.task)) return <BuyerOutreachTaskDetail {...props} />;
  if (isNetworkOutreachTask(props.task)) return <NetworkOutreachTaskDetail {...props} />;
  if (isNetworkInputsTask(props.task)) return <NetworkInputsTaskDetail {...props} />;
  if (isExecutionChecklistTask(props.task)) return <ExecutionChecklistTaskDetail {...props} />;
  if (isProjectPullTask(props.task)) return <ProjectPullTaskDetail {...props} />;
  if (isTransplantReadinessTask(props.task)) return <TransplantReadinessTaskDetail {...props} />;
  if (isWeeklyHarvestTask(props.task)) return <WeeklyHarvestTaskDetail {...props} />;

  return <AssignedTaskExecutionShell {...props} />;
}
